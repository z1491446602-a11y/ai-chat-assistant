import { useEffect, useRef, useState } from 'react';
import { FileText, Mic, Play, Square } from 'lucide-react';

interface AudioMessageProps {
  audioUrl: string;
  duration?: number;
  isCurrentUser: boolean;
  onLongPress?: () => void;
  hintText?: string;
  transcript?: string;
  showTranscript?: boolean;
  onToggleTranscript?: () => void;
}

const WAVE_BARS = [12, 20, 15, 24, 16, 21, 13];

export function AudioMessage({
  audioUrl,
  duration,
  isCurrentUser,
  onLongPress,
  hintText,
  transcript,
  showTranscript = false,
  onToggleTranscript,
}: AudioMessageProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [actualDuration, setActualDuration] = useState(duration || 0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const holdTimerRef = useRef<number | null>(null);
  const normalizedTranscript = String(transcript || '').trim();
  const canToggleTranscript = Boolean(normalizedTranscript);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const togglePlay = async () => {
    if (!audioRef.current) {
      return;
    }

    try {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        await audioRef.current.play();
      }
    } catch (error) {
      console.error('音频播放失败', error);
    }
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const updateTime = () => {
      setCurrentTime(audio.currentTime);
    };
    const handleLoadedMetadata = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setActualDuration(audio.duration);
      }
    };
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    audio.addEventListener('timeupdate', updateTime);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);

    return () => {
      audio.removeEventListener('timeupdate', updateTime);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
    };
  }, []);

  useEffect(() => {
    if (duration && duration > 0) {
      setActualDuration(duration);
    }
  }, [duration]);

  useEffect(() => {
    return () => {
      if (holdTimerRef.current) {
        window.clearTimeout(holdTimerRef.current);
      }
    };
  }, []);

  const clearHoldTimer = () => {
    if (holdTimerRef.current) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  const startLongPress = () => {
    if (!onLongPress) {
      return;
    }

    clearHoldTimer();
    holdTimerRef.current = window.setTimeout(() => {
      onLongPress();
      holdTimerRef.current = null;
    }, 450);
  };

  const progressPercent = actualDuration > 0
    ? Math.min(100, Math.max(0, (currentTime / actualDuration) * 100))
    : 0;

  return (
    <div className="audio-message-shell">
      <div
        className={`audio-bubble-cute ${isCurrentUser ? 'audio-bubble-user' : 'audio-bubble-ai'}`}
        onContextMenu={(event) => {
          if (!onLongPress) {
            return;
          }
          event.preventDefault();
          onLongPress();
        }}
        onTouchStart={startLongPress}
        onTouchEnd={clearHoldTimer}
        onTouchCancel={clearHoldTimer}
        onMouseDown={startLongPress}
        onMouseUp={clearHoldTimer}
        onMouseLeave={clearHoldTimer}
      >
        <button
          type="button"
          onClick={togglePlay}
          className={`audio-play-btn ${isCurrentUser ? 'audio-play-btn-user' : 'audio-play-btn-ai'}`}
          aria-label={isPlaying ? '暂停语音' : '播放语音'}
        >
          {isPlaying ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-[1px]" />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <div
              className={`audio-wave ${isPlaying ? 'is-playing' : ''} ${isCurrentUser ? 'audio-wave-user' : 'audio-wave-ai'}`}
              aria-hidden="true"
            >
              {WAVE_BARS.map((height, index) => (
                <span
                  key={`${audioUrl}-wave-${index}`}
                  style={{ height: `${height}px`, animationDelay: `${index * 0.08}s` }}
                />
              ))}
            </div>
              <span className={`shrink-0 text-[11px] font-semibold ${isCurrentUser ? 'text-sky-700' : 'text-slate-600'}`}>
              {formatTime(actualDuration || currentTime)}
            </span>
          </div>

          <div className={`mt-2 h-1.5 overflow-hidden rounded-full ${isCurrentUser ? 'bg-sky-100' : 'bg-slate-100'}`}>
            <div
              className={`h-full rounded-full transition-all duration-200 ${isCurrentUser ? 'bg-sky-500' : 'bg-blue-500'}`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          <div className="mt-2 flex items-center justify-between gap-2">
            <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${isCurrentUser ? 'text-sky-700' : 'text-slate-600'}`}>
              <Mic className="h-3.5 w-3.5" />
              {hintText || '点击收听'}
            </span>
            {canToggleTranscript ? (
              <button
                type="button"
                onClick={onToggleTranscript}
                className={`audio-transcript-btn ${isCurrentUser ? 'audio-transcript-btn-user' : 'audio-transcript-btn-ai'}`}
                aria-expanded={showTranscript}
              >
                <FileText className="h-3.5 w-3.5" />
                {showTranscript ? '收起文字' : '转文字'}
              </button>
            ) : null}
          </div>
        </div>

        <audio ref={audioRef} src={audioUrl} preload="metadata" />
      </div>

      {canToggleTranscript && showTranscript ? (
        <div className={`audio-transcript-panel ${isCurrentUser ? 'audio-transcript-panel-user' : 'audio-transcript-panel-ai'}`}>
          {normalizedTranscript}
        </div>
      ) : null}
    </div>
  );
}

interface VoiceRecorderProps {
  onSend: (audioBlob: Blob, duration: number) => void;
  onCancel: () => void;
  sendLabel?: string;
}

export function VoiceRecorder({ onSend, onCancel, sendLabel = '发送' }: VoiceRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];
      startTimeRef.current = Date.now();

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start();
      setIsRecording(true);

      timerRef.current = setInterval(() => {
        setRecordingTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 100);
    } catch (error) {
      console.error('录音失败', error);
    }
  };

  const stopRecording = () => {
    if (!mediaRecorderRef.current || !isRecording) {
      return;
    }

    mediaRecorderRef.current.stop();

    mediaRecorderRef.current.onstop = () => {
      const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
      const duration = Math.floor((Date.now() - startTimeRef.current) / 1000);
      onSend(audioBlob, duration);
    };

    mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    setIsRecording(false);

    if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    setRecordingTime(0);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex items-center gap-3 rounded-t-2xl border-t border-gray-200 bg-white p-4">
      {!isRecording ? (
        <>
          <button
            onClick={startRecording}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 via-cyan-500 to-blue-600 py-3 text-white transition-all hover:shadow-lg hover:shadow-sky-400/30"
          >
            <Mic className="h-5 w-5" />
            <span className="font-medium">按住说话</span>
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-3 text-gray-500 hover:text-gray-700"
          >
            取消
          </button>
        </>
      ) : (
        <>
          <div className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-50 py-3">
            <div className="h-3 w-3 animate-pulse rounded-full bg-red-500" />
            <span className="font-medium text-red-500">{formatTime(recordingTime)}</span>
          </div>
          <button
            onClick={stopRecording}
            className="rounded-xl bg-gradient-to-r from-green-400 to-green-500 px-4 py-3 text-white transition-all hover:shadow-lg hover:shadow-green-400/30"
          >
            {sendLabel}
          </button>
        </>
      )}
    </div>
  );
}
