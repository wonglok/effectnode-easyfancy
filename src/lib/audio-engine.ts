const AUDIO_URLS = {
  ambient: "/audio/bg-music-low-fi.mp3",
  click: "/audio/ui-click.wav",
};

/** Music sits below the UI clicks. */
const MUSIC_VOLUME = 0.34;
const SFX_VOLUME = 0.62;
/** Music fade length; HTMLMediaElement has no gain ramp, so we tween volume. */
const MUSIC_FADE_MS = 700;
/** A few elements so rapid clicks can overlap instead of cutting each other. */
const CLICK_POOL_SIZE = 3;

export type AudioSettings = {
  soundFx: boolean;
  music: boolean;
};

/**
 * Audio built on HTML audio elements: one looping element for the background
 * music and a small pool for UI clicks. There is no Web Audio graph, so all a
 * browser needs is for playback to start from a user gesture.
 */
class AudioEngine {
  private music: HTMLAudioElement | null = null;
  private clicks: HTMLAudioElement[] = [];
  private clickIndex = 0;
  private musicFade: number | null = null;
  private settings: AudioSettings = { soundFx: true, music: false };

  /**
   * Called from the first pointer input. Creating the elements and starting
   * the music here keeps playback inside the gesture the browser requires.
   */
  async start(settings: AudioSettings) {
    this.settings = settings;
    if (typeof window === "undefined") return;

    this.ensureClickPool();
    this.syncMusic();
  }

  setSoundFx(enabled: boolean) {
    this.settings.soundFx = enabled;
    if (enabled) this.playUiClick();
  }

  setMusic(enabled: boolean) {
    this.settings.music = enabled;
    this.syncMusic();
  }

  playUiClick() {
    if (!this.settings.soundFx || typeof window === "undefined") return;

    const element = this.nextClickElement();
    if (!element) return;

    // Restart the element so every click is heard from the top.
    element.currentTime = 0;
    void element.play().catch(() => {
      // Blocked or not loaded yet; the next click retries.
    });
  }

  private ensureClickPool() {
    if (this.clicks.length > 0 || typeof window === "undefined") return;

    for (let index = 0; index < CLICK_POOL_SIZE; index += 1) {
      const element = document.createElement("audio");
      element.src = AUDIO_URLS.click;
      element.preload = "auto";
      element.volume = SFX_VOLUME;
      this.clicks.push(element);
    }
  }

  private nextClickElement() {
    this.ensureClickPool();
    if (this.clicks.length === 0) return null;

    const element = this.clicks[this.clickIndex];
    this.clickIndex = (this.clickIndex + 1) % this.clicks.length;
    return element;
  }

  private ensureMusicElement() {
    if (this.music || typeof window === "undefined") return this.music;

    const element = document.createElement("audio");
    element.src = AUDIO_URLS.ambient;
    element.loop = true;
    element.preload = "none";
    element.volume = 0;
    this.music = element;
    return element;
  }

  private syncMusic() {
    const element = this.ensureMusicElement();
    if (!element) return;

    if (this.settings.music) {
      if (element.paused) {
        element.volume = 0;
        void element
          .play()
          .then(() => {
            // The user may have muted again while the element was starting.
            if (this.settings.music) this.fadeMusic(MUSIC_VOLUME);
          })
          .catch(() => {
            // Autoplay blocked; toggling music again retries.
          });
        return;
      }

      this.fadeMusic(MUSIC_VOLUME);
      return;
    }

    if (element.paused && element.volume === 0) return;
    this.fadeMusic(0);
  }

  private fadeMusic(target: number) {
    const element = this.music;
    if (!element) return;

    if (this.musicFade !== null) {
      window.clearInterval(this.musicFade);
      this.musicFade = null;
    }

    const from = element.volume;
    const started = window.performance.now();
    const timer = window.setInterval(() => {
      const current = this.music;
      if (!current) return;

      const t = Math.min(1, (window.performance.now() - started) / MUSIC_FADE_MS);
      current.volume = Math.min(1, Math.max(0, from + (target - from) * t));

      if (t < 1) return;

      window.clearInterval(timer);
      if (this.musicFade === timer) this.musicFade = null;
      if (target === 0) current.pause();
    }, 40);

    this.musicFade = timer;
  }
}

export const audioEngine = new AudioEngine();
