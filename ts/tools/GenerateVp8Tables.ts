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

const RFC_URL: string = "https://www.rfc-editor.org/rfc/rfc6386.txt";
const PAGE_LINE: RegExp = /^(?:Bankoski, et al\.\s+Informational\s+\[Page \d+\]|RFC 6386\s+VP8 Data Format and Decoding Guide\s+November 2011)\s*$/;
const COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const NUMBER: RegExp = /\d+/g;
const PER_LINE: number = 20;
const TABLES: ReadonlyArray<readonly [string, string, number]> = [
    ["kf_bmode_prob", "KF_BMODE_PROBS", 10 * 10 * 9],
    ["coeff_update_probs", "COEFF_UPDATE_PROBS", 4 * 8 * 3 * 11],
    ["default_coeff_probs", "DEFAULT_COEFF_PROBS", 4 * 8 * 3 * 11],
    ["dc_qlookup", "DC_QUANT", 128],
    ["ac_qlookup", "AC_QUANT", 128]
];

class Vp8TableGenerator {

    private readonly outputPath: string;

    constructor(outputPath: string) {
        this.outputPath = outputPath;
    }

    async run(): Promise<void> {
        const response: Response = await fetch(RFC_URL);
        if (!response.ok) {
            throw new Error("Failed to fetch " + RFC_URL + ": " + response.status + " " + response.statusText);
        }
        // The tables of RFC 6386 run across pages, whose header and footer lines and form feeds fall inside them.
        const text: string = (await response.text()).split(/\r?\n/).filter((line: string) => !PAGE_LINE.test(line) && !line.includes("\f")).join("\n");
        const tables: Array<readonly [string, ReadonlyArray<number>]> = TABLES.map(([name, constant, count]: readonly [string, string, number]) =>
            [constant, this.table(text, name, count)]);
        mkdirSync(dirname(this.outputPath), { recursive: true });
        writeFileSync(this.outputPath, this.render(tables), "utf8");
    }

    private table(text: string, name: string, count: number): ReadonlyArray<number> {
        // The first declaration of the table that has an initializer gives its values, in the order of its indexes.
        const declaration: RegExp = new RegExp("\\b" + name + "\\s*\\[", "g");
        for (const match of text.matchAll(declaration)) {
            const end: number = text.indexOf(";", match.index);
            const statement: string = text.substring(match.index, end);
            const open: number = statement.indexOf("{");
            if (!statement.includes("=") || open < 0) {
                continue;
            }
            const values: Array<number> = (statement.substring(open).replace(COMMENT, "").match(NUMBER) ?? []).map(Number);
            if (values.length !== count) {
                throw new Error("The table " + name + " of RFC 6386 has " + values.length + " values instead of " + count);
            }
            return values;
        }
        throw new Error("RFC 6386 has no initialized table " + name);
    }

    private render(tables: ReadonlyArray<readonly [string, ReadonlyArray<number>]>): string {
        let output: string = "/*******************************************************************************\n" +
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
            " *******************************************************************************/\n";
        for (const [constant, values] of tables) {
            const lines: Array<string> = [];
            for (let start: number = 0; start < values.length; start += PER_LINE) {
                lines.push("    " + values.slice(start, start + PER_LINE).join(", "));
            }
            output += "\nexport const " + constant + ": ReadonlyArray<number> = [\n" + lines.join(",\n") + "\n];\n";
        }
        return output;
    }
}

const PACKAGE_ROOT: string = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..");
try {
    await new Vp8TableGenerator(join(PACKAGE_ROOT, "ts", "images", "generated", "Vp8Tables.ts")).run();
    console.log("Generated ts/images/generated/Vp8Tables.ts");
} catch (error) {
    console.error("Error generating the VP8 tables:", error);
    process.exitCode = 1;
}
