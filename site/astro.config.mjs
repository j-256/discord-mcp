import { unified } from "@astrojs/markdown-remark"
import starlight from "@astrojs/starlight"
import { defineConfig } from "astro/config"

import accessibleTables from "./plugins/accessible-tables.mjs"

const SITE_ORIGIN = "https://guildcontrol.lasers.app"
const REPOSITORY_URL = "https://github.com/j-256/guildcontrol"

const referenceGroups = [
  ["Foundations", "foundations"],
  ["Read and discovery", "read-and-discovery"],
  ["Messages and interactions", "messages-and-interactions"],
  ["Guild lifecycle", "guild-lifecycle"],
  ["Channels and roles", "channels-and-roles"],
  ["Publishing and members", "publishing-and-members"],
  ["Verification", "verification"],
]

export default defineConfig({
  markdown: {
    processor: unified({ rehypePlugins: [accessibleTables], smartypants: false }),
  },
  output: "static",
  site: SITE_ORIGIN,
  trailingSlash: "always",
  integrations: [
    starlight({
      components: {
        Footer: "./src/components/ReleaseFooter.astro",
      },
      credits: true,
      customCss: ["./src/styles/custom.css"],
      description: "Owner-managed Discord access with exact scope, reviewed writes, and privacy-safe evidence",
      disable404Route: true,
      editLink: {
        baseUrl: `${REPOSITORY_URL}/edit/main/site/src/content/docs/`,
      },
      favicon: "/generated/guildcontrol-icon.png",
      head: [
        {
          tag: "meta",
          attrs: {
            content: "default-src 'none'; base-uri 'self'; connect-src 'self'; font-src 'self'; form-action 'none'; frame-src 'none'; img-src 'self' data:; manifest-src 'self'; media-src 'self'; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; worker-src 'self'",
            "http-equiv": "Content-Security-Policy",
          },
        },
        {
          tag: "meta",
          attrs: {
            content: "no-referrer",
            name: "referrer",
          },
        },
        {
          tag: "meta",
          attrs: {
            content: "#5865f2",
            name: "theme-color",
          },
        },
      ],
      lastUpdated: false,
      logo: {
        alt: "GuildControl MCP shield and reviewed connection icon",
        src: "../assets/guildcontrol-icon.png",
      },
      pagefind: true,
      pagination: true,
      sidebar: [
        {
          label: "Start",
          items: [
            { label: "Overview", link: "/" },
            "start/choose",
            "start/getting-started",
            "start/manual-setup",
            "start/migration",
          ],
        },
        {
          label: "Understand",
          items: [
            "understand/safety",
            "understand/boundaries",
            "understand/comparison",
            "understand/project-overview",
          ],
        },
        {
          label: "Operate",
          items: [
            "operate",
            "operate/troubleshooting",
            "operate/release-verification",
          ],
        },
        {
          label: "Reference",
          items: [
            "reference",
            ...referenceGroups.map(([label, directory]) => ({
              collapsed: true,
              items: [{
                autogenerate: { directory: `reference/capabilities/${directory}` },
              }],
              label,
            })),
            {
              attrs: { rel: "noopener noreferrer", target: "_blank" },
              label: "Exact contract explorer",
              link: `${SITE_ORIGIN}/generated/contract-explorer.html`,
            },
            "security",
          ],
        },
        {
          label: "Contribute",
          items: [
            "contribute",
            "contribute/contributing",
            "contribute/code-of-conduct",
          ],
        },
      ],
      social: [{
        href: REPOSITORY_URL,
        icon: "github",
        label: "GitHub repository",
      }],
      tableOfContents: {
        maxHeadingLevel: 3,
        minHeadingLevel: 2,
      },
      title: "GuildControl MCP",
      titleDelimiter: "|",
    }),
  ],
})
