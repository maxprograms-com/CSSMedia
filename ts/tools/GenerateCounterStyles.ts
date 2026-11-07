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

import type { CssNode, StyleSheet, Value } from "css-tree";
import { parse } from "css-tree";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { CssIdentifierEscaping } from "../css/CssIdentifierEscaping.js";
import type { CssValue } from "../css/values/CssValue.js";
import { CssValueParser } from "../css/values/CssValueParser.js";

const SOURCE_URL: string = "https://www.w3.org/TR/css-counter-styles-3/";
const NORMATIVE_BLOCK: RegExp = /<pre class="stylesheet">([\s\S]*?)<\/pre>/g;
const ENTITIES: Readonly<Record<string, string>> = { "lt": "<", "gt": ">", "amp": "&", "quot": "\"", "apos": "'" };
const INVISIBLE: RegExp = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Zs}]/u;

interface CounterStyleSource {
    name: string;
    descriptors: Record<string, CssValue>;
}

class CounterStylesGenerator {

    private readonly outputPath: string;
    private readonly values: CssValueParser = new CssValueParser();
    private readonly escaping: CssIdentifierEscaping = new CssIdentifierEscaping();

    constructor(outputPath: string) {
        this.outputPath = outputPath;
    }

    async run(): Promise<void> {
        const response: Response = await fetch(SOURCE_URL);
        if (!response.ok) {
            throw new Error("Failed to fetch " + SOURCE_URL + ": " + response.status + " " + response.statusText);
        }
        // CSS Counter Styles 3 §6 and §7.1: the normative stylesheet fragments that define the predefined counter styles.
        const page: string = await response.text();
        let css: string = "";
        for (const block of page.matchAll(NORMATIVE_BLOCK)) {
            css += this.plainText(block[1]) + "\n";
        }
        const styles: Array<CounterStyleSource> = this.counterStyles(parse(css) as StyleSheet);
        console.log("Read " + styles.length + " predefined counter styles");
        mkdirSync(dirname(this.outputPath), { recursive: true });
        writeFileSync(this.outputPath, this.render(styles), "utf8");
    }

    private counterStyles(sheet: StyleSheet): Array<CounterStyleSource> {
        const styles: Array<CounterStyleSource> = [];
        for (const node of sheet.children) {
            if (node.type !== "Atrule" || node.name !== "counter-style" || node.block === null || node.prelude === null || node.prelude.type !== "AtrulePrelude") {
                continue;
            }
            const first: CssNode | null = node.prelude.children.first;
            if (first === null || first.type !== "Identifier") {
                throw new Error("A predefined @counter-style rule has no name");
            }
            const name: string = this.escaping.unescape(first.name);
            const descriptors: Record<string, CssValue> = {};
            for (const child of node.block.children) {
                if (child.type !== "Declaration") {
                    continue;
                }
                const value: CssValue | undefined = child.value.type === "Value" ? this.values.parse(child.value as Value) : undefined;
                if (value === undefined) {
                    throw new Error("The " + child.property + " descriptor of the predefined counter style " + name + " cannot be read");
                }
                descriptors[child.property.toLowerCase()] = value;
            }
            styles.push({ name, descriptors });
        }
        return styles;
    }

    private plainText(markup: string): string {
        return markup.replace(/<[^>]*>/g, "").replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (entity: string, name: string): string => {
            if (name.startsWith("#x") || name.startsWith("#X")) {
                return String.fromCodePoint(Number.parseInt(name.substring(2), 16));
            }
            if (name.startsWith("#")) {
                return String.fromCodePoint(Number(name.substring(1)));
            }
            return ENTITIES[name.toLowerCase()] ?? entity;
        });
    }

    private render(styles: ReadonlyArray<CounterStyleSource>): string {
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
        const rows: Array<string> = styles.map((style: CounterStyleSource) => "    [" + this.literal(style.name) + ", " + this.literal(style.descriptors) + "]");
        return header + "import type { CssValue } from \"../../css/values/CssValue.js\";\n\n"
            + "export const PREDEFINED_COUNTER_STYLES: ReadonlyArray<readonly [string, Readonly<Record<string, CssValue>>]> = [\n" + rows.join(",\n") + "\n];\n";
    }

    private literal(value: unknown): string {
        // Invisible characters (control, format and space characters other than the plain space) are written as escapes.
        let escaped: string = "";
        for (const character of JSON.stringify(value)) {
            if (character !== " " && INVISIBLE.test(character)) {
                for (let index: number = 0; index < character.length; index++) {
                    escaped += "\\u" + character.charCodeAt(index).toString(16).toUpperCase().padStart(4, "0");
                }
            } else {
                escaped += character;
            }
        }
        return escaped;
    }
}

const PACKAGE_ROOT: string = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..");
try {
    await new CounterStylesGenerator(join(PACKAGE_ROOT, "ts", "pdf", "generated", "PredefinedCounterStyles.ts")).run();
    console.log("Generated ts/pdf/generated/PredefinedCounterStyles.ts");
} catch (error) {
    console.error("Error generating the predefined counter styles:", error);
    process.exitCode = 1;
}
