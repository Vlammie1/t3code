import type { EnvironmentId } from "@t3tools/contracts";
import { ChevronLeftIcon, ChevronRightIcon, ImagesIcon } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { useAssetUrlState } from "../../assets/assetUrls";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import type { SessionImage } from "./sessionImages";

function useSessionImageSrc(environmentId: EnvironmentId, image: SessionImage): string | null {
  const assetUrl = useAssetUrlState(
    environmentId,
    image.origin === "read" ? image.asset.resource : image.resource,
  );
  if (image.origin === "attached" && image.src !== null) return image.src;
  if (assetUrl._tag !== "Success") return null;
  return image.origin === "read" ? `${assetUrl.url}${image.asset.srcFragment}` : assetUrl.url;
}

function SessionImageView(props: {
  readonly environmentId: EnvironmentId;
  readonly image: SessionImage;
  readonly className?: string;
  readonly alt: string;
}) {
  const src = useSessionImageSrc(props.environmentId, props.image);
  if (src === null) {
    return <span className={cn("block animate-pulse bg-foreground/5", props.className)} />;
  }
  return <img src={src} alt={props.alt} draggable={false} className={props.className} />;
}

/** Every image read or sent in this thread, one large view and a filmstrip to page through. */
export function SessionImagesPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly images: ReadonlyArray<SessionImage>;
}) {
  const { environmentId, images } = props;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIndex = Math.max(
    0,
    images.findIndex((image) => image.id === selectedId),
  );
  const selected = images[selectedIndex] ?? null;
  const thumbRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    if (selected === null) return;
    thumbRefs.current.get(selected.id)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selected]);

  if (selected === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <span className="flex size-11 items-center justify-center rounded-full bg-foreground/5 text-muted-foreground">
          <ImagesIcon className="size-5" />
        </span>
        <p className="text-sm text-foreground">No images yet</p>
        <p className="max-w-56 text-xs text-muted-foreground">
          Images the agent opens and images you send show up here.
        </p>
      </div>
    );
  }

  const step = (delta: number) => {
    const next = images[(selectedIndex + delta + images.length) % images.length];
    if (next) setSelectedId(next.id);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      step(-1);
    } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      step(1);
    }
  };

  return (
    <div
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label="Session images"
      className="flex h-full min-h-0 flex-col gap-3 p-3 outline-none"
    >
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium break-all text-foreground">{selected.name}</span>
          <span className="text-xs text-muted-foreground">
            {selected.origin === "read" ? "Read by the agent" : "Sent by you"}
          </span>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {selectedIndex + 1} / {images.length}
        </span>
        <div className="flex shrink-0 items-center">
          <Button
            size="icon-sm"
            variant="ghost-muted"
            aria-label="Previous image"
            disabled={images.length < 2}
            onClick={() => step(-1)}
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost-muted"
            aria-label="Next image"
            disabled={images.length < 2}
            onClick={() => step(1)}
          >
            <ChevronRightIcon />
          </Button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-2xl bg-foreground/5">
        <SessionImageView
          key={selected.id}
          environmentId={environmentId}
          image={selected}
          alt={selected.name}
          className="max-h-full max-w-full object-contain"
        />
      </div>

      <div className="-mx-3 flex shrink-0 gap-2 overflow-x-auto px-3 py-1.5 [scrollbar-width:none]">
        {images.map((image, index) => (
          <button
            key={image.id}
            ref={(element) => {
              if (element) thumbRefs.current.set(image.id, element);
              else thumbRefs.current.delete(image.id);
            }}
            type="button"
            aria-label={`Show image ${index + 1}: ${image.name}`}
            aria-current={image.id === selected.id}
            onClick={() => setSelectedId(image.id)}
            className={cn(
              "relative size-14 shrink-0 overflow-hidden rounded-xl bg-foreground/5 transition-[opacity,box-shadow] duration-200",
              image.id === selected.id
                ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                : "opacity-60 hover:opacity-100",
            )}
          >
            <SessionImageView
              environmentId={environmentId}
              image={image}
              alt=""
              className="size-full object-cover"
            />
          </button>
        ))}
      </div>
    </div>
  );
}
