import { afterAll, beforeAll } from "vitest";
import { startGalleryServer, type GalleryServer } from "./gallery-server.ts";

export function galleryServer() {
  let vite: GalleryServer | undefined;
  const server = { url: "" };
  beforeAll(async () => {
    vite = await startGalleryServer();
    server.url = vite.url;
  }, 60_000);
  afterAll(async () => {
    await vite?.stop();
  });
  return server;
}
