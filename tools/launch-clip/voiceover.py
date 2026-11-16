# Thai voice-over for น้องขุนเงิน (Microsoft Edge neural TTS via edge-tts), placed on the clip timeline.
# usage: python3 voiceover.py tts   -> build/vo/NN.mp3 (needs network: speech.platform.bing.com)
#        python3 voiceover.py mix build/mix.wav out.wav  -> voice over music/SFX with ducking
import asyncio, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
VO = os.path.join(HERE, 'build', 'vo')
VOICE = 'th-TH-PremwadeeNeural'
PITCH = os.environ.get('VO_PITCH', '+45Hz')  # higher = younger, sweeter
RATE = os.environ.get('VO_RATE', '+6%')

# (start seconds, latest end, text) — same lines as voiceover.txt
LINES = [
    (0.25, 3.5, 'ตีแบดก๊วน Sena กับ 88 จบในไลน์แล้วค่า!'),
    (3.6, 7.2, 'แค่พิมพ์ แบดบอท ในกลุ่ม เมนูของหนูก็เด้งขึ้นมาเลย'),
    (7.6, 11.2, 'กดจอง ก็เข้าเว็บในไลน์ได้ทันที'),
    (11.5, 15.8, 'เลือกวัน กดยืนยัน จองเสร็จแล้วค่า'),
    (16.4, 19.8, 'ลงชื่อปุ๊บ หนูส่งรายชื่อเข้ากลุ่มให้ปั๊บ'),
    (20.0, 24.3, 'ตีเสร็จแล้ว ผู้จัดเปิดบิล หนูจะมาเรียกเก็บเองน้า'),
    (24.8, 29.5, 'สแกนคิวอาร์ โอนเงิน แล้วแนบสลิป'),
    (30.0, 35.2, 'กดตกลง ก็จ่ายแล้วทันที ไม่ต้องรอผู้จัดเลยค่า'),
    (35.6, 41.9, 'พอจ่ายครบทุกคน หนูจะแจ้งในกลุ่มเอง ผู้จัดไม่ต้องไล่ทวงแล้วน้า'),
    (42.6, 46.3, 'หนูน้องขุนเงิน ขอรับหน้าที่แทนพี่ขุนทองนะคะ'),
    (46.4, 48.9, 'ให้โอกาสหนูหน่อยน้าา'),
    (49.3, 52.0, 'SENA Court ค่า!'),
]


async def tts():
    import edge_tts
    os.makedirs(VO, exist_ok=True)
    proxy = os.environ.get('HTTPS_PROXY') or None
    for i, (_, _, text) in enumerate(LINES):
        raw = os.path.join(VO, f'{i:02d}-raw.mp3')
        for attempt in range(4):
            try:
                await edge_tts.Communicate(text, VOICE, pitch=PITCH, rate=RATE, proxy=proxy).save(raw)
                break
            except edge_tts.exceptions.NoAudioReceived:
                if attempt == 3:
                    raise
                await asyncio.sleep(2 + attempt * 2)
        # raise formants a little (shorter "vocal tract" = younger), keep the speed
        k = float(os.environ.get('VO_SHIFT', '1.09'))
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', raw, '-af',
                        f'asetrate={int(24000 * k)},aresample=44100,atempo={1 / k:.4f}', os.path.join(VO, f'{i:02d}.mp3')], check=True)
        print('tts', i, text)


def dur(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
                         capture_output=True, text=True).stdout
    return float(out)


def mix(bed, out):
    ins, chains, labels = ['-i', bed], [], []
    for i, (start, end, _) in enumerate(LINES):
        f = os.path.join(VO, f'{i:02d}.mp3')
        d = dur(f)
        room = end - start
        speed = max(1.0, d / room)  # only speed up a line that would overrun its scene
        ins += ['-i', f]
        tempo = f'atempo={speed:.3f},' if speed > 1.001 else ''
        chains.append(f'[{i + 1}:a]{tempo}aformat=sample_rates=44100:channel_layouts=stereo,adelay={int(start * 1000)}|{int(start * 1000)}[v{i}]')
        labels.append(f'[v{i}]')
        print(f'line {i:2d}: {d:.2f}s in {room:.2f}s' + (f'  (x{speed:.2f})' if speed > 1.001 else ''))
    n = len(LINES)
    graph = ';'.join(chains) + ';' + ''.join(labels) + f'amix=inputs={n}:normalize=0,volume=1.6,asplit=2[voice][key];' \
        '[0:a][key]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=350[bed];' \
        '[bed][voice]amix=inputs=2:normalize=0,alimiter=limit=0.95[out]'
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', *ins, '-filter_complex', graph, '-map', '[out]', out], check=True)
    print('mixed', out)


if __name__ == '__main__':
    if sys.argv[1] == 'tts':
        asyncio.run(tts())
    else:
        mix(sys.argv[2], sys.argv[3])
