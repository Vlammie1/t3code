import type { AppIcon, AppIconProps } from "./appIcons";

// Fluent glyphs are filled shapes, which a stroke morph cannot interpolate, so
// a state change swaps the glyph in place.
export function SwapIcon({ icon: Icon, ...props }: AppIconProps & { readonly icon: AppIcon }) {
  return <Icon {...props} />;
}
