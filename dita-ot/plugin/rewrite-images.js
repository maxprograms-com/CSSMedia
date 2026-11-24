#!/usr/bin/env node
/*******************************************************************************
 * Copyright (c) 2026 Maxprograms. All rights reserved.
 *
 * Licensed under the Business Source License 1.1 (the "License");
 * you may not use this file except in compliance with the License.
 *
 * Change Date: 2030-11-01
 * Change License: Mozilla Public License, v. 2.0
 *
 * Additional Use Grant:
 * You may make production use of the Licensed Work for personal use,
 * educational use, and academic research. "Personal use" means use by an
 * individual for their own purposes, and not on behalf of an employer, client
 * or other organization. You may also make production use of the Licensed Work
 * for trial purposes for a period of up to 30 days.
 *
 * You may obtain a copy of the License at https://spdx.org/licenses/BUSL-1.1.html
 * or in the LICENSE file provided in the root of this repository.
 *******************************************************************************/

// Rewrites the hashed image references of a DITA-OT merged file to the
// absolute source paths recorded in the DITA-OT job file (.job.xml), the
// same way the FO pipeline resolves them. Only href attributes whose value
// matches an image or MathML entry in the job file are changed; everything
// else is preserved byte for byte.

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";

const [, , jobXmlPath, mergedXmlPath, rewrittenXmlPath] = process.argv;

if (jobXmlPath === undefined || mergedXmlPath === undefined || rewrittenXmlPath === undefined) {
    console.error("Usage: node rewrite-images.js <job.xml> <merged.xml> <rewritten.xml>");
    process.exit(2);
}

const npmRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
const cssmediaRoot = join(npmRoot, "cssmedia");
const require = createRequire(join(cssmediaRoot, "package.json"));
const { SAXParser, DOMBuilder } = require("typesxml");

function parseJob(path) {
    const parser = new SAXParser();
    const builder = new DOMBuilder();
    parser.setContentHandler(builder);
    parser.parseFile(path);
    const root = builder.getDocument()?.getRoot();
    if (root === undefined) {
        throw new Error("Could not parse " + path);
    }
    const files = root.getChild("files");
    if (files === undefined) {
        throw new Error("No <files> element in " + path);
    }
    const images = new Map();
    for (const file of files.getChildren()) {
        const format = file.getAttribute("format")?.getValue();
        if (format !== "image" && format !== "mml") continue;
        const uri = file.getAttribute("uri")?.getValue();
        const src = file.getAttribute("src")?.getValue();
        if (uri === undefined || src === undefined) continue;
        images.set(uri, src);
    }
    return images;
}

const images = parseJob(jobXmlPath);
if (images.size === 0) {
    console.error("No image entries found in " + jobXmlPath);
    process.exit(1);
}

const merged = readFileSync(mergedXmlPath, "utf8");
let rewritten = merged;
for (const [uri, src] of images) {
    rewritten = rewritten.split("href=\"" + uri + "\"").join("href=\"" + src + "\"");
}
writeFileSync(rewrittenXmlPath, rewritten);
console.log("Rewrote " + images.size + " hashed image references in " + mergedXmlPath + " -> " + rewrittenXmlPath);
