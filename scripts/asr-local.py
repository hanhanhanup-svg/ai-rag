"""Offline CPU transcription adapter. stdout contains only the evidence result."""
import argparse
import io
import json
import os
import sys
from pathlib import Path
os.environ.setdefault('HF_HUB_OFFLINE', '1')
os.environ.setdefault('HF_HUB_DISABLE_TELEMETRY', '1')

def decode_local(source):
    import av
    import numpy as np
    resampler = av.AudioResampler(format='s16', layout='mono', rate=16000)
    raw = io.BytesIO()
    with av.open(str(source), mode='r', options={'protocol_whitelist': 'file,pipe'}) as media:
        if not any(stream.type == 'audio' for stream in media.streams):
            raise ValueError('ASR_AUDIO_MISSING')
        if media.duration and media.duration / av.time_base > 3600:
            raise ValueError('ASR_DURATION_LIMIT')
        def append(frame):
            for converted in resampler.resample(frame):
                raw.write(converted.to_ndarray().tobytes())
                if raw.tell() > 3600 * 16000 * 2:
                    raise ValueError('ASR_DURATION_LIMIT')
        for frame in media.decode(audio=0):
            frame.pts = None
            append(frame)
        append(None)
    if not raw.tell():
        raise ValueError('ASR_AUDIO_EMPTY')
    return np.frombuffer(raw.getvalue(), dtype=np.int16).astype(np.float32) / 32768.0

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--model', default=str(Path(__file__).resolve().parents[1] / 'models' / 'faster-whisper-small'))
    args = parser.parse_args()
    source, model_dir = Path(args.input), Path(args.model)
    if not source.is_file() or source.stat().st_size > 100 * 1024 * 1024:
        raise ValueError('ASR_INPUT_INVALID')
    if not (model_dir / 'model.bin').is_file():
        raise ValueError('ASR_MODEL_MISSING')
    audio = decode_local(source)
    from faster_whisper import WhisperModel
    model = WhisperModel(str(model_dir), device='cpu', compute_type='int8', cpu_threads=4, num_workers=1, local_files_only=True)
    segments, info = model.transcribe(audio, beam_size=3, language='zh', vad_filter=True, condition_on_previous_text=False)
    rows = []
    for segment in segments:
        content = segment.text.strip()
        if content:
            rows.append({'startMs': max(0, round(segment.start * 1000)), 'endMs': min(round(info.duration * 1000), round(segment.end * 1000)), 'text': content})
    if not rows:
        raise ValueError('ASR_NO_SPEECH')
    print(json.dumps({'parser': 'faster-whisper-local', 'model': 'small-cpu-int8', 'durationMs': round(info.duration * 1000), 'segments': rows, 'coverage': 'complete', 'warnings': ['本地语音识别结果尚需校对；设备编号、数字、单位及专业术语请结合原音核验。时间戳为语音识别估计位置。']}, ensure_ascii=False))

if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    try:
        main()
    except Exception as error:
        code = str(error) if str(error).startswith('ASR_') else 'ASR_PROCESS_FAILED'
        print(json.dumps({'error': code}), file=sys.stderr)
        sys.exit(1)