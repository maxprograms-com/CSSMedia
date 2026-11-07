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

import { createHash } from "node:crypto";
import type { PdfFile } from "./PdfFile.js";
import { PdfSyntax } from "./PdfSyntax.js";

export interface ColorSpaceResource {
    key: string;
    value: string;
    components: number;
}

const DEVICE_SPACES: ReadonlyArray<string> = ["", "DeviceGray", "", "DeviceRGB", "DeviceCMYK"];
const D50_WHITE: ReadonlyArray<number> = [0.9642, 1, 0.8249];
const LAB_RANGE: ReadonlyArray<number> = [-128, 127, -128, 127];
const TINT_BITS: number = 16;
const PROCESS_INKS: ReadonlySet<string> = new Set<string>(["Cyan", "Magenta", "Yellow", "Black"]);

export class PdfColorSpaces {

    static readonly GRAY: ColorSpaceResource = { key: "DeviceGray", value: "/DeviceGray", components: 1 };
    static readonly RGB: ColorSpaceResource = { key: "DeviceRGB", value: "/DeviceRGB", components: 3 };
    static readonly CMYK: ColorSpaceResource = { key: "DeviceCMYK", value: "/DeviceCMYK", components: 4 };

    private readonly file: PdfFile;
    private readonly syntax: PdfSyntax = new PdfSyntax();
    private readonly profiles: Map<string, ColorSpaceResource> = new Map<string, ColorSpaceResource>();
    private lab?: ColorSpaceResource;

    constructor(file: PdfFile) {
        this.file = file;
    }

    restart(): void {
        this.profiles.clear();
        delete this.lab;
    }

    deviceN(names: ReadonlyArray<string>, sizes: ReadonlyArray<number>, samples: Uint8Array, alone: ReadonlyArray<Uint8Array>): ColorSpaceResource {
        // §8.6.6.5: [/DeviceN names alternateSpace tintTransform attributes], which gives the inks to a device that has them
        // and the alternate to one that does not. Table 70: Colorants describes each ink alone, the transform only together.
        const object: number = this.tintTransform(sizes, samples);
        const lab: string = this.labSpace().value;
        const inks: string = names.map((name: string) => this.syntax.name(name)).join(" ");
        const colorants: string = names.filter((name: string) => !PROCESS_INKS.has(name)).map((name: string) => {
            const ink: string = this.syntax.name(name);
            const channel: number = names.indexOf(name);
            return ink + " [/Separation " + ink + " " + lab + " " + this.syntax.reference(this.tintTransform([sizes[channel]], alone[channel])) + "]";
        }).join(" ");
        const attributes: string = colorants.length === 0 ? "" : " " + this.syntax.reference(this.file.add("<< /Colorants << " + colorants + " >> >>"));
        return { key: "DN" + object, value: "[/DeviceN [" + inks + "] " + lab + " " + this.syntax.reference(object) + attributes + "]", components: names.length };
    }

    private tintTransform(sizes: ReadonlyArray<number>, samples: Uint8Array): number {
        // §7.10.2: a sampled function, here to Lab in 16 bits.
        const domain: string = sizes.map(() => "0 1").join(" ");
        return this.file.addStream("/FunctionType 0 /Domain [" + domain + "] /Range [0 100 " + this.syntax.numbers(LAB_RANGE) + "] /Size [" + sizes.join(" ")
            + "] /BitsPerSample " + TINT_BITS, samples, true);
    }

    icc(profile: Uint8Array, components: number): ColorSpaceResource {
        // ISO 32000-2 §8.6.5.5: [/ICCBased stream], with N the number of components, 1, 3 or 4, and the device space of
        // that number as the alternate; one stream for each profile, whatever uses it.
        const digest: string = createHash("md5").update(profile).digest("hex");
        let resource: ColorSpaceResource | undefined = this.profiles.get(digest);
        if (resource === undefined) {
            const object: number = this.file.addStream("/N " + components + " /Alternate /" + DEVICE_SPACES[components], profile, true);
            resource = { key: "ICC" + object, value: "[/ICCBased " + this.syntax.reference(object) + "]", components };
            this.profiles.set(digest, resource);
        }
        return resource;
    }

    calibrated(gamma: ReadonlyArray<number>, white: ReadonlyArray<number>, matrix?: ReadonlyArray<number>): ColorSpaceResource {
        // §8.6.5.2 and §8.6.5.3: CalGray with one gamma, CalRGB with three and the matrix of the primaries in CIE XYZ.
        const gray: boolean = matrix === undefined;
        const entries: string = "/WhitePoint [" + this.syntax.numbers(white) + "] /Gamma " + (gray ? this.syntax.number(gamma[0]) : "[" + this.syntax.numbers(gamma) + "]")
            + (matrix === undefined ? "" : " /Matrix [" + this.syntax.numbers(matrix) + "]");
        const object: number = this.file.add("<< " + entries + " >>");
        return { key: "Cal" + object, value: "[/" + (gray ? "CalGray" : "CalRGB") + " " + this.syntax.reference(object) + "]", components: gray ? 1 : 3 };
    }

    labSpace(): ColorSpaceResource {
        // §8.6.5.4: CIE L*a*b* relative to the D50 white point, which is that of the lab() colours of CSS Color 4.
        if (this.lab === undefined) {
            const object: number = this.file.add("<< /WhitePoint [" + this.syntax.numbers(D50_WHITE) + "] /Range [" + this.syntax.numbers(LAB_RANGE) + "] >>");
            this.lab = { key: "Lab" + object, value: "[/Lab " + this.syntax.reference(object) + "]", components: 3 };
        }
        return this.lab;
    }
}
