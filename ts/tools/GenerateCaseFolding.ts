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

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_URL: string = "https://www.unicode.org/Public/UCD/latest/ucd/CaseFolding.txt";
const LINE: RegExp = /^([0-9A-F]+);\s*([CFST]);\s*([0-9A-F ]+);/;

interface Folding {
    code: number;
    folded: ReadonlyArray<number>;
}

class CaseFoldingGenerator {

    private readonly outputPath: string;

    constructor(outputPath: string) {
        this.outputPath = outputPath;
    }

    async run(): Promise<void> {
        const response: Response = await fetch(SOURCE_URL);
        if (!response.ok) {
            throw new Error("Failed to fetch " + SOURCE_URL + ": " + response.status + " " + response.statusText);
        }
        const foldings: Array<Folding> = this.parse(await response.text());
        console.log("Read " + foldings.length + " case foldings");
        mkdirSync(dirname(this.outputPath), { recursive: true });
        writeFileSync(this.outputPath, this.render(foldings), "utf8");
    }

    private parse(text: string): Array<Folding> {
        // CSS Fonts 4 §5.1: Default Caseless Matching uses the mappings with status C or F.
        const foldings: Array<Folding> = [];
        for (const line of text.split("\n")) {
            const match: RegExpExecArray | null = LINE.exec(line);
            if (match === null || (match[2] !== "C" && match[2] !== "F")) {
                continue;
            }
            const folded: Array<number> = match[3].trim().split(/\s+/).map((part: string) => Number.parseInt(part, 16));
            foldings.push({ code: Number.parseInt(match[1], 16), folded });
        }
        return foldings.sort((first: Folding, second: Folding) => first.code - second.code);
    }

    private render(foldings: ReadonlyArray<Folding>): string {
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
        const rows: Array<string> = foldings.map((folding: Folding) =>
            "    [0x" + this.hex(folding.code) + ", [" + folding.folded.map((code: number) => "0x" + this.hex(code)).join(", ") + "]]");
        return header + "export const CASE_FOLDING: ReadonlyArray<readonly [number, ReadonlyArray<number>]> = [\n" + rows.join(",\n") + "\n];\n";
    }

    private hex(code: number): string {
        return code.toString(16).toUpperCase();
    }
}

const PACKAGE_ROOT: string = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..");
try {
    await new CaseFoldingGenerator(join(PACKAGE_ROOT, "ts", "fonts", "generated", "CaseFolding.ts")).run();
    console.log("Generated ts/fonts/generated/CaseFolding.ts");
} catch (error) {
    console.error("Error generating the case folding table:", error);
    process.exitCode = 1;
}
