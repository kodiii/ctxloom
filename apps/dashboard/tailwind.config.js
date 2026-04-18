import { fileURLToPath } from 'url';
import path from 'path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export default {
  content: [path.resolve(__dirname, 'client/src/**/*.{ts,tsx}')],
  theme: { extend: {} },
  plugins: [],
};
