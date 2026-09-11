"""Generate the small, deterministic email mark. Requires Pillow (pip install Pillow).

Frame one is the finished tick. A single soft highlight crosses its ring; the
tick never flashes or disappears. GIF repeat extension is omitted, which means
one playback (loop=1 would repeat the animation once, playing it twice).
"""

from pathlib import Path
from PIL import Image, ImageDraw

DESTINATION = Path(__file__).resolve().parents[1] / "packages/web/public/email"
SIZE = (160, 96)
SCALE = 3
PAPER = (255, 254, 251)
TEAL = (0, 110, 146)
MINT = (16, 183, 152)
GOLD = (250, 167, 74)


def frame(highlight=None):
    canvas = Image.new("RGB", (SIZE[0] * SCALE, SIZE[1] * SCALE), PAPER)
    draw = ImageDraw.Draw(canvas)
    ring = tuple(value * SCALE for value in (48, 16, 112, 80))
    draw.ellipse(ring, fill=(241, 236, 226), outline=TEAL, width=2 * SCALE)
    if highlight is not None:
        draw.arc(ring, highlight, highlight + 36, fill=GOLD, width=3 * SCALE)
    draw.line(
        [(65 * SCALE, 47 * SCALE), (76 * SCALE, 58 * SCALE), (96 * SCALE, 37 * SCALE)],
        fill=MINT,
        width=5 * SCALE,
        joint="curve",
    )
    return canvas.resize(SIZE, Image.Resampling.LANCZOS)


if __name__ == "__main__":
    DESTINATION.mkdir(parents=True, exist_ok=True)
    resting = frame()
    # One shared palette keeps the paper colour stable between frames.
    palette = resting.quantize(colors=128)
    frames = [resting] + [frame(-120 + i * 20) for i in range(12)] + [resting]
    indexed = [item.quantize(palette=palette, dither=Image.Dither.NONE) for item in frames]
    output = DESTINATION / "founding-welcome.gif"
    indexed[0].save(
        output,
        save_all=True,
        append_images=indexed[1:],
        duration=[250] + [100] * 12 + [250],
        disposal=2,
        optimize=False,
    )
    with Image.open(output) as result:
        assert "loop" not in result.info, "GIF must play once, not repeat"
        assert result.size == SIZE
        assert output.stat().st_size < 500_000
        duration = 0
        for number in range(result.n_frames):
            result.seek(number)
            duration += result.info["duration"]
        assert duration <= 2000
        result.seek(0)
        first = result.convert("RGB").tobytes()
        result.seek(result.n_frames - 1)
        assert first == result.convert("RGB").tobytes(), "First frame must be resting state"
        print(f"{output}: {output.stat().st_size} bytes, {result.n_frames} frames, {duration}ms, one playback")
