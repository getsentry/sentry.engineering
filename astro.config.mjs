import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import rehypeSlug from "rehype-slug";

export default defineConfig({
  site: "https://sentry.engineering",
  output: "static",
  experimental: {
    csp: {
      scriptDirective: {
        resources: ["'self'", "https://plausible.io"],
        hashes: ["sha256-t7UDmDY4iklZOU6hhoaa4oMgQfLaBBT9DlTNiRW7xE0="],
      },
      directives: ["connect-src 'self' https://plausible.io"],
    },
  },
  integrations: [sitemap()],
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
    rehypePlugins: [rehypeSlug],
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
