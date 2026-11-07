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

import { existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { parseArgs } from "node:util";
import { PdfGenerator } from "./PdfGenerator.js";

interface CliArguments {
    xml: string;
    css: string;
    pdf: string;
    fonts?: string;
    catalog?: string;
}

interface ParsedOptions {
    xml?: string;
    css?: string;
    pdf?: string;
    fonts?: string;
    catalog?: string;
}

class CssMediaCli {

    run(argumentsList: ReadonlyArray<string>): number {
        const parsed: CliArguments | string = this.parse(argumentsList);
        if (typeof parsed === "string") {
            if (parsed.length > 0) {
                console.error("cssmedia: " + parsed);
            }
            console.error(this.usage());
            return 2;
        }
        const generator: PdfGenerator = new PdfGenerator(parsed.fonts, parsed.catalog);
        try {
            for (const path of [parsed.xml, parsed.css]) {
                if (!existsSync(path)) {
                    throw new Error("File not found: " + path);
                }
            }
            if (parsed.fonts !== undefined && !existsSync(parsed.fonts)) {
                throw new Error("Font folder not found: " + parsed.fonts);
            }
            if (parsed.catalog !== undefined && !existsSync(parsed.catalog)) {
                throw new Error("Catalog file not found: " + parsed.catalog);
            }
            generator.generate(parsed.xml, parsed.css, parsed.pdf);
            return 0;
        } catch (error) {
            console.error("cssmedia: " + (error instanceof Error ? error.message : String(error)));
            return 1;
        } finally {
            for (const warning of generator.warnings) {
                console.error("cssmedia: warning: " + warning);
            }
        }
    }

    private parse(argumentsList: ReadonlyArray<string>): CliArguments | string {
        if (argumentsList.length === 0) {
            return "";
        }
        let values: ParsedOptions;
        try {
            values = parseArgs({
                args: [...argumentsList],
                options: {
                    xml: { type: "string", short: "x" },
                    css: { type: "string", short: "c" },
                    pdf: { type: "string", short: "p" },
                    fonts: { type: "string", short: "f" },
                    catalog: { type: "string", short: "g" }
                }
            }).values as ParsedOptions;
        } catch (error) {
            return error instanceof Error ? error.message : String(error);
        }
        if (values.xml === undefined) {
            return "Missing XML file (-x, --xml)";
        }
        if (values.css === undefined) {
            return "Missing CSS file (-c, --css)";
        }
        if (values.pdf === undefined) {
            return "Missing PDF file (-p, --pdf)";
        }
        const parsed: CliArguments = { xml: resolvePath(values.xml), css: resolvePath(values.css), pdf: resolvePath(values.pdf) };
        if (values.fonts !== undefined) {
            parsed.fonts = resolvePath(values.fonts);
        }
        if (values.catalog !== undefined) {
            parsed.catalog = resolvePath(values.catalog);
        }
        return parsed;
    }

    private usage(): string {
        return [
            "",
            "Usage: cssmedia -x <file> -c <file> -p <file> [-f <fontsFolder>] [-g <catalog>]",
            "",
            "  -x, --xml <file>       XML file to format",
            "  -c, --css <file>       CSS stylesheet to apply",
            "  -p, --pdf <file>       PDF file to write",
            "  -f, --fonts <folder>   (optional) alternative fonts folder",
            "  -g, --catalog <file>   (optional) OASIS catalog to use when parsing XML",
            ""
        ].join("\n");
    }
}

process.exitCode = new CssMediaCli().run(process.argv.slice(2));
