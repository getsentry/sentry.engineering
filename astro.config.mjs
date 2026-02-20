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
        hashes: [
          "sha256-t7UDmDY4iklZOU6hhoaa4oMgQfLaBBT9DlTNiRW7xE0=", // Theme init
          "sha256-p7WGvXPfCjOpbo9APNa4AJgj/jO9xZr9aBlEFVcuKUM=", // Plausible init
          "sha256-sVlNBziRgfCssLPd9yhI6q2CTDvIhhkPyoUn5B+G1HI=", // Theme toggle
          "sha256-m+TqEPNJoIsN5pFYeHFt2az1Myng7rZ6Y/9yJIokBrk=", // Post list search
        ],
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
