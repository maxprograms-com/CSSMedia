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

import { writeFileSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_URL: string = "https://www.unicode.org/Public/UCD/latest/ucd/extracted/DerivedJoiningType.txt";
const LINE: RegExp = /^([0-9A-F]+)(?:\.\.([0-9A-F]+))?\s*;\s*([CDLRT])\b/;

interface JoiningRange {
    start: number;
    end: number;
    type: string;
}

class JoiningTypeGenerator {

    private readonly outputPath: string;

    constructor(outputPath: string) {
        this.outputPath = outputPath;
    }

    async run(): Promise<void> {
        const response: Response = await fetch(SOURCE_URL);
        if (!response.ok) {
            throw new Error("Failed to fetch " + SOURCE_URL + ": " + response.status + " " + response.statusText);
        }
        const ranges: Array<JoiningRange> = this.parse(await response.text());
        console.log("Read " + ranges.length + " joining type ranges");
        writeFileSync(this.outputPath, this.render(ranges), "utf8");
    }

    private parse(text: string): Array<JoiningRange> {
        const ranges: Array<JoiningRange> = [];
        for (const line of text.split("\n")) {
            const match: RegExpExecArray | null = LINE.exec(line);
            if (match === null) {
                continue;
            }
            const start: number = Number.parseInt(match[1], 16);
            const end: number = match[2] === undefined ? start : Number.parseInt(match[2], 16);
            ranges.push({ start, end, type: match[3] });
        }
        return ranges.sort((first: JoiningRange, second: JoiningRange) => first.start - second.start);
    }

    private render(ranges: ReadonlyArray<JoiningRange>): string {
        const header: string =
            "/*******************************************************************************\n" +
            " * Copyright (c) 2026 Maxprograms. All rights reserved.\n" +
            " *\n" +
            " * Licensed under the Business Source License 1.1 (the \"License\");\n" +
            " * you may not use this file except in compliance with the License.\n" +
            " *\n" +
            " * Change Date: 2030-11-01\n" +
            " * Change License: Mozilla Public License, v. 2.0\n" +
            " *\n" +
            " * Additional Use Grant:\n" +
            " * You may make production use of the Licensed Work for personal use,\n" +
            " * educational use, and academic research. \"Personal use\" means use by an\n" +
            " * individual for their own purposes, and not on behalf of an employer, client\n" +
            " * or other organization. You may also make production use of the Licensed Work\n" +
            " * for trial purposes for a period of up to 30 days.\n" +
            " *\n" +
            " * You may obtain a copy of the License at https://spdx.org/licenses/BUSL-1.1.html\n" +
            " * or in the LICENSE file provided in the root of this repository.\n" +
            " *******************************************************************************/\n\n";
        const rows: Array<string> = ranges.map((range: JoiningRange) => "    [0x" + range.start.toString(16).toUpperCase() + ", 0x" + range.end.toString(16).toUpperCase() + ", \"" + range.type + "\"]");
        return header + "export const JOINING_TYPES: ReadonlyArray<readonly [number, number, string]> = [\n" + rows.join(",\n") + "\n];\n";
    }
}

const PACKAGE_ROOT: string = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..");
try {
    await new JoiningTypeGenerator(join(PACKAGE_ROOT, "ts", "fonts", "generated", "JoiningTypes.ts")).run();
    console.log("Generated ts/fonts/generated/JoiningTypes.ts");
} catch (error) {
    console.error("Error generating the joining types table:", error);
    process.exitCode = 1;
}
