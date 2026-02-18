import { slugify } from "./slugify.js";

export function formatDate(value, locale = "en-US") {
  if (!value) {
    return "";
  }

  return new Date(value).toLocaleDateString(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function trimString(value, length = 400) {
  if (!value) {
    return "";
  }

  return value.length > length ? `${value.substring(0, length - 3)}...` : value;
}

export function toTagSlug(value) {
  return slugify(value);
}

export function isExternalLink(href) {
  return typeof href === "string" && !href.startsWith("/") && !href.startsWith("#");
}

export function titleFromTag(tag) {
  if (!tag) {
    return "";
  }

  return tag[0].toUpperCase() + tag.slice(1);
}
