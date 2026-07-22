import { notFound } from "next/navigation";
import { PostPreview } from "@/components/features/composer/post-preview";
import type { MediaAssetView } from "@/components/features/composer/media-types";
import { PLATFORM_LIST } from "@/lib/platforms/config";
import { isProduction } from "@/lib/env/runtime";

/**
 * Dev-only C5 preview gallery: renders every platform's feed-accurate preview
 * card with sample content, so previews can be eyeballed WITHOUT connecting a
 * social account or seeding the DB (the composer gates platform selection to
 * connected accounts). Not a product surface — `notFound()` in production so it
 * never ships. Visit `/dev/previews` with the dev server running.
 */

const SAMPLE_CAPTION =
  "🚀 NEW COURSE: Django + Next.js 16 + Inngest\n\nWe're thrilled to announce our latest comprehensive course covering three game-changing technologies that'll level up your full-stack development skills! Build robust backend APIs, lightning-fast frontends, and event-driven architecture. #webdev #fullstack";

const SAMPLE_IDENTITY = {
  handle: "driftwood.coffee",
  avatarUrl: null,
  name: "Driftwood Coffee",
};

// A clean inline gradient card in the platform's accent color stands in for
// uploaded media — no R2/MinIO or network asset needed. Square (1080²) so feed
// frames fill and 9:16 frames object-cover the centered content. `n` varies the
// id + a corner number so a multi-image carousel shows distinct slides.
function sampleImageFor(color: string, n = 1): MediaAssetView {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='1080' height='1080' viewBox='0 0 1080 1080'>
    <defs>
      <linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
        <stop offset='0' stop-color='${color}'/>
        <stop offset='1' stop-color='#12141a'/>
      </linearGradient>
      <radialGradient id='h' cx='0.28' cy='0.22' r='0.85'>
        <stop offset='0' stop-color='#ffffff' stop-opacity='0.35'/>
        <stop offset='1' stop-color='#ffffff' stop-opacity='0'/>
      </radialGradient>
    </defs>
    <rect width='1080' height='1080' fill='url(#g)'/>
    <rect width='1080' height='1080' fill='url(#h)'/>
    <circle cx='860' cy='240' r='150' fill='#ffffff' fill-opacity='0.10'/>
    <circle cx='190' cy='900' r='230' fill='#000000' fill-opacity='0.10'/>
    <text x='540' y='512' font-family='ui-sans-serif, system-ui, sans-serif' font-size='96' font-weight='700' fill='#ffffff' text-anchor='middle'>Driftwood</text>
    <text x='540' y='620' font-family='ui-sans-serif, system-ui, sans-serif' font-size='96' font-weight='700' fill='#ffffff' text-anchor='middle'>Coffee</text>
    <text x='540' y='706' font-family='ui-sans-serif, system-ui, sans-serif' font-size='32' fill='#ffffff' fill-opacity='0.75' text-anchor='middle' letter-spacing='8'>SAMPLE ${n}</text>
  </svg>`;
  return {
    id: `sample-${color}-${n}`,
    kind: "image",
    url: `data:image/svg+xml,${encodeURIComponent(svg)}`,
    mimeType: "image/svg+xml",
    sizeBytes: 4096,
    width: 1080,
    height: 1080,
    durationSeconds: null,
    moderationStatus: "approved",
  };
}

// A video sample so Reel/Shorts/vertical layouts render. There's no real clip,
// so it reuses the gradient as the video `poster` — the frame shows a clean
// still (a real upload would show its first frame via `preload="metadata"`).
function sampleVideoFor(color: string): MediaAssetView {
  const poster = sampleImageFor(color).url;
  return {
    id: `sample-video-${color}`,
    kind: "video",
    url: poster,
    posterUrl: poster,
    mimeType: "video/mp4",
    sizeBytes: 8192,
    width: 1080,
    height: 1920,
    durationSeconds: 20,
    moderationStatus: "approved",
  };
}

export default function PreviewGalleryPage() {
  if (isProduction()) notFound();

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-xl font-semibold">C5 preview gallery (dev only)</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every platform&apos;s feed-accurate preview with sample content — no
          account connection or seeded data required. Each row shows the same
          post as a <strong>mixed image + video carousel</strong> (swipe /
          scroll — dots track position), a single <strong>video</strong>{" "}
          (Instagram / Facebook switch to a 9:16 Reel; TikTok / YouTube are
          Shorts), and <strong>text-only</strong>. Note: the sample video is a
          placeholder poster, so it won&apos;t actually play here — video
          playback (click ▶) works in the composer with a real upload.
        </p>
      </header>

      <div className="space-y-14">
        {PLATFORM_LIST.map((platform) => (
          <section
            key={platform.id}
            className="space-y-6 border-t border-border pt-8 first:border-t-0 first:pt-0"
          >
            <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
              {platform.label}
            </h2>
            <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
              <PostPreview
                platform={platform.id}
                caption={SAMPLE_CAPTION}
                // Image-led mixed set: image + video + image. Hero is an image,
                // so IG/FB stay a feed carousel (not a Reel) with a video slide.
                assets={[
                  sampleImageFor(platform.color, 1),
                  sampleVideoFor(platform.color),
                  sampleImageFor(platform.color, 2),
                ]}
                identity={SAMPLE_IDENTITY}
              />
              <PostPreview
                platform={platform.id}
                caption={SAMPLE_CAPTION}
                assets={[sampleVideoFor(platform.color)]}
                identity={SAMPLE_IDENTITY}
              />
              <PostPreview
                platform={platform.id}
                caption={SAMPLE_CAPTION}
                assets={[]}
                identity={SAMPLE_IDENTITY}
              />
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
