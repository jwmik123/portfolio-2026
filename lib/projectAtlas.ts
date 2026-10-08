import {
  CanvasTexture,
  ClampToEdgeWrapping,
  LinearFilter,
  SRGBColorSpace,
} from "three/webgpu";

/**
 * A project's screenshots baked into one tall texture ("film strip").
 * The hole is a porthole onto this strip; scrolling is a uv offset, so
 * dragging the slider costs nothing per frame.
 */
export interface ProjectAtlas {
  texture: CanvasTexture;
  /** strip width expressed in strip-v units — ties u and v to one scale */
  widthV: number;
  /** strip v at the centre of each screenshot, in order */
  centers: number[];
  count: number;
}

/** Most GPUs guarantee 8192; stay well inside it. */
const MAX_HEIGHT = 8192;
const GAP_RATIO = 0.035;
/**
 * Blank run above the first screenshot and below the last, so the dome — which
 * is taller than one screenshot — never runs off the end of the strip. It is
 * left fully transparent: filling it would put a hard dark band inside the
 * glass, which is the border we are trying not to have.
 */
const PAD_RATIO = 0.62;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

export async function buildProjectAtlas(
  urls: string[],
  baseWidth = 1600
): Promise<ProjectAtlas> {
  const images = await Promise.all(urls.map(loadImage));

  // Lay every screenshot out at the same width, stacked with a gap.
  const gap = baseWidth * GAP_RATIO;
  const heights = images.map((img) => {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    return baseWidth * (h / w);
  });

  const pad = baseWidth * PAD_RATIO;
  let total =
    heights.reduce((a, b) => a + b, 0) + gap * (images.length - 1) + pad * 2;

  // Shrink uniformly if the strip would blow past the texture limit.
  let scale = 1;
  if (total > MAX_HEIGHT) {
    scale = MAX_HEIGHT / total;
    total = MAX_HEIGHT;
  }

  const width = Math.round(baseWidth * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = Math.round(total);

  const ctx = canvas.getContext("2d")!;

  const centers: number[] = [];
  let y = pad * scale;
  images.forEach((img, i) => {
    const h = heights[i] * scale;
    ctx.drawImage(img, 0, y, width, h);
    // CanvasTexture flips v, so canvas y maps to 1 - y / height
    centers.push(1 - (y + h / 2) / canvas.height);
    y += h + gap * scale;
  });

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.premultiplyAlpha = false;
  texture.needsUpdate = true;

  return {
    texture,
    widthV: canvas.width / canvas.height,
    centers,
    count: images.length,
  };
}
