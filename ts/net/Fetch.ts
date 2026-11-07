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

export class Fetch {

    static async run(url: string): Promise<void> {
        const response: Response = await fetch(url, { redirect: "follow" });
        if (!response.ok) {
            throw new Error("HTTP " + response.status + " " + response.statusText);
        }
        const bytes: Uint8Array = new Uint8Array(await response.arrayBuffer());
        process.stdout.write(Buffer.from(bytes).toString("base64"));
    }
}

const url: string | undefined = process.argv[2];
if (url === undefined) {
    process.exitCode = 1;
} else {
    Fetch.run(url).catch((error: unknown): void => {
        // fetch() rejects with only "fetch failed", and what went wrong is in its cause.
        const cause: unknown = error instanceof Error ? error.cause ?? error : error;
        process.stderr.write(cause instanceof Error ? cause.message : String(cause));
        process.exitCode = 1;
    });
}
