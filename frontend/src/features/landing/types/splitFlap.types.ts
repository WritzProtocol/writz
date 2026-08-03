export interface SplitFlapAudioContextValue {
  isMuted: boolean;
  toggleMute: () => void;
  playClick: () => void;
}

export interface SplitFlapCharState {
  currentChar: string;
  isSettled: boolean;
}
