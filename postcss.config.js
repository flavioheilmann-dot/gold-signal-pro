import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import { fileURLToPath } from "node:url";

// Pin the Tailwind config to an absolute path so it resolves correctly
// regardless of the process cwd the dev server is launched from.
const tailwindConfig = fileURLToPath(
  new URL("./tailwind.config.js", import.meta.url)
);

export default {
  plugins: [tailwindcss({ config: tailwindConfig }), autoprefixer()],
};
