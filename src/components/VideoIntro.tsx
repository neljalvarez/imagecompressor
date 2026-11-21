import { useEffect, useRef, useState } from 'react';

export const INTRO_VIDEO_ID = 'QDto0H8AB7s';
const SEEN_KEY = 'icl-intro-video-seen';
const API_TIMEOUT_MS = 10_000;

/* ---------- Minimal typings for the YouTube IFrame Player API ---------- */
interface YTPlayer {
  playVideo(): void;
  stopVideo(): void;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  setVolume(v: number): void;
  getPlayerState(): number;
  destroy(): void;
}
interface YTPlayerEvent {
  target: YTPlayer;
  data: number;
}
interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId: string;
      width?: string | number;
      height?: string | number;
      playerVars?: Record<string, string | number>;
      events?: Partial<Record<'onReady' | 'onStateChange' | 'onError' | 'onAutoplayBlocked', (e: YTPlayerEvent) => void>>;
    },
  ) => YTPlayer;
  PlayerState: { ENDED: number; PLAYING: number; PAUSED: number; BUFFERING: number; CUED: number; UNSTARTED: number };
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;

/** Loads https://www.youtube.com/iframe_api once. Rejects on network failure or timeout. */
export function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<YTNamespace>((resolve, reject) => {
    const timer = setTimeout(() => fail(new Error('timeout')), API_TIMEOUT_MS);
    const fail = (err: Error) => {
      clearTimeout(timer);
      apiPromise = null; // allow a retry the next time the popup opens
      reject(err);
    };
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      clearTimeout(timer);
      if (window.YT?.Player) resolve(window.YT);
      else fail(new Error('YouTube API unavailable'));
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = () => {
      s.remove();
      fail(new Error('Could not load the YouTube player'));
    };
    document.head.appendChild(s);
  });
  return apiPromise;
}

/** True when the popup has not yet been shown in this browser session. */
export function shouldAutoShowIntro(): boolean {
  try {
    return sessionStorage.getItem(SEEN_KEY) !== '1';
  } catch {
    return true;
  }
}

function markIntroSeen() {
  try {
    sessionStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* storage disabled: the popup may show again on reload, which is harmless */
  }
}

interface Props {
  onClose: () => void;
}

type Phase = 'loading' | 'playing' | 'error';

/** Centered modal with the intro video. Mount it to open; unmounting destroys the player. */
export function VideoIntro({ onClose }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const closedRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [phase, setPhase] = useState<Phase>('loading');
  const [muted, setMuted] = useState(false);

  const close = () => {
    if (closedRef.current) return;
    closedRef.current = true;
    const p = playerRef.current;
    playerRef.current = null;
    try {
      p?.stopVideo();
    } catch {
      /* player may not be ready */
    }
    try {
      p?.destroy(); // removes the iframe, so playback stops completely
    } catch {
      /* ignore */
    }
    onCloseRef.current();
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    markIntroSeen();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeBtn.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
      }
    };
    window.addEventListener('keydown', onKey, true);

    let cancelled = false;
    let autoplayCheck: ReturnType<typeof setTimeout> | undefined;

    const fallBackToMuted = (p: YTPlayer) => {
      try {
        p.mute();
        p.playVideo();
        setMuted(true);
      } catch {
        /* ignore */
      }
    };

    loadYouTubeApi()
      .then((YT) => {
        if (cancelled || !mountRef.current) return;
        const target = document.createElement('div');
        mountRef.current.replaceChildren(target);
        playerRef.current = new YT.Player(target, {
          videoId: INTRO_VIDEO_ID,
          width: '100%',
          height: '100%',
          playerVars: { autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1, origin: window.location.origin },
          events: {
            onReady: (e) => {
              if (cancelled) return;
              setPhase('playing');
              e.target.playVideo();
              // If the browser silently refused to start playback with sound, retry muted.
              autoplayCheck = setTimeout(() => {
                if (cancelled || !playerRef.current) return;
                const st = e.target.getPlayerState();
                if (st !== YT.PlayerState.PLAYING && st !== YT.PlayerState.BUFFERING && st !== YT.PlayerState.ENDED) fallBackToMuted(e.target);
              }, 1500);
            },
            onAutoplayBlocked: (e) => !cancelled && fallBackToMuted(e.target),
            onStateChange: (e) => {
              if (e.data === YT.PlayerState.ENDED) closeRef.current();
              else if (e.data === YT.PlayerState.PLAYING) setMuted(e.target.isMuted());
            },
            onError: () => !cancelled && setPhase('error'),
          },
        });
      })
      .catch(() => !cancelled && setPhase('error'));

    return () => {
      cancelled = true;
      clearTimeout(autoplayCheck);
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
      // Unmounting for any reason must also stop the video.
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {
          /* ignore */
        }
        playerRef.current = null;
      }
    };
  }, []);

  const unmute = () => {
    const p = playerRef.current;
    if (!p) return;
    p.unMute();
    p.setVolume(100);
    p.playVideo();
    setMuted(false);
  };

  return (
    <div
      className="intro-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Introductory video"
      data-testid="intro-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="intro-box">
        <button ref={closeBtn} type="button" className="intro-close" aria-label="Close video" onClick={close} data-testid="intro-close">
          ×
        </button>
        <div className="intro-frame">
          <div ref={mountRef} className="intro-player" data-testid="intro-player" />
          {phase === 'loading' && <div className="intro-status">Loading video…</div>}
          {phase === 'error' && (
            <div className="intro-status error-state" data-testid="intro-error">
              <p>The video couldn't be loaded.</p>
              <a href={`https://youtu.be/${INTRO_VIDEO_ID}`} target="_blank" rel="noopener noreferrer">
                Watch it on YouTube ↗
              </a>
            </div>
          )}
          {phase === 'playing' && muted && (
            <button type="button" className="intro-unmute" onClick={unmute} data-testid="intro-unmute">
              🔇 Tap to unmute
            </button>
          )}
        </div>
        <button type="button" className="intro-skip" onClick={close} data-testid="intro-skip">
          {phase === 'error' ? 'Continue to website' : 'Skip to website'} →
        </button>
      </div>
    </div>
  );
}
