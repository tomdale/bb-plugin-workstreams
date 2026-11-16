/**
 * The preview host's stylesheet, built from `preview/document.css` by
 * `npm run build` (its `prebuild` step) and bundled into the host entry as
 * text. Only the host entry imports this module.
 */
import styles from "../../../../preview/dist/document-css.txt";

export const PREVIEW_STYLES: string = styles;
