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

import type { SpawnSyncReturns } from "node:child_process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TIMEOUT_MS: number = 30000;
const MAX_BUFFER: number = 256 * 1024 * 1024;

export class RemoteResource {

    private failed?: readonly [string, string];

    failure(url: string): string {
        return this.failed !== undefined && this.failed[0] === url && this.failed[1].length > 0 ? ": " + this.failed[1] : "";
    }

    retrieveBytes(url: string): Buffer | undefined {
        // Node has no synchronous HTTP request, so the fetch runs in a child process that writes the bytes as base64.
        const fetchScript: string = fileURLToPath(new URL("./Fetch.js", import.meta.url));
        const result: SpawnSyncReturns<string> = spawnSync(process.execPath, [fetchScript, url], {
            encoding: "utf8",
            maxBuffer: MAX_BUFFER,
            timeout: TIMEOUT_MS
        });
        if (result.error !== undefined || result.status !== 0) {
            this.failed = [url, result.error?.message ?? result.stderr.trim()];
            return undefined;
        }
        return Buffer.from(result.stdout.trim(), "base64");
    }
}
