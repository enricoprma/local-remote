import express from "express";
import path from "node:path";
import cookieParser from "cookie-parser";

import { Bonjour } from "bonjour-service";

import {
  getLocalUrls,
  mdnsHostname,
  mdnsUrl,
  port,
} from "./network";

import { robotJsInput } from "./robotJsInput";
import { createApi } from "./api";
import { auth } from "./auth";

const bonjour = new Bonjour(
  undefined,
  (error: any) => {
    console.error("mDNS error:", error);
  },
);

const app = express();

app.use(express.json({ limit: "2kb" }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.use("/api", createApi(robotJsInput, auth));

app.listen(port, "0.0.0.0", () => {
  bonjour.publish({
    name: "Local Remote",
    type: "http",
    host: mdnsHostname,
    port,
  });

  console.log("Local Remote running:\n");

  console.log(mdnsUrl);

  for (const url of getLocalUrls()) {
    console.log(url);
  }
});