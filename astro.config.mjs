import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import sentry from "@sentry/astro";
import tailwindcss from "@tailwindcss/vite";
import rehypeSlug from "rehype-slug";

const isProduction = process.env.NODE_ENV === "production";

export default defineConfig({
  site: "https://sentry.engineering",
  output: "static",
  integrations: [
    sitemap(),
    ...(isProduction
      ? [
          sentry({
            enabled: {
              client: true,
              server: false,
            },
            sourcemaps: {
              disable: true,
            },
          }),
        ]
      : []),
  ],
  image: {
    service: {
      entrypoint: "astro/assets/services/sharp",
      config: {
        limitInputPixels: false,
      },
    },
  },
  markdown: {
    shikiConfig: {
      theme: "night-owl",
    },
    rehypePlugins: [
      rehypeSlug,
    ],
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
