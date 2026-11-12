/**
 * The BB Workstreams Stream Deck plugin: keys and a Stream Deck + dial that
 * show Workstreams' Up Next and open its threads in BB.
 */
import streamDeck from "@elgato/streamdeck";
import { execFile } from "node:child_process";
import { NextKey } from "./actions/next-key.ts";
import { ThreadKey } from "./actions/thread-key.ts";
import { UpNextDial } from "./actions/up-next-dial.ts";
import { UpNextConnection } from "./connection.ts";
import { discover, type GlobalSettings } from "./discovery.ts";

const logger = streamDeck.logger.createScope("Workstreams");

const connection = new UpNextConnection({
  discover: (settings) => discover(settings),
  bringForward: (app) =>
    execFile("open", ["-a", app], (error) => {
      if (error) logger.warn(`Bringing BB forward failed: ${error.message}`);
    }),
  log: (message) => logger.warn(message),
});

streamDeck.actions.registerAction(new ThreadKey(connection));
streamDeck.actions.registerAction(new NextKey(connection));
streamDeck.actions.registerAction(new UpNextDial(connection));
streamDeck.settings.onDidReceiveGlobalSettings<GlobalSettings>(({ settings }) =>
  connection.configure(settings),
);
streamDeck.system.onSystemDidWakeUp(() => connection.reconnect());

await streamDeck.connect();
connection.configure(
  await streamDeck.settings.getGlobalSettings<GlobalSettings>(),
);
