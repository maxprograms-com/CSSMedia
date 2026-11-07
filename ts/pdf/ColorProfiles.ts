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

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { DeclaredValue, DescriptorRule } from "../css/Stylesheet.js";
import type { ProfileColors } from "../css/values/ColorParser.js";
import { ColorSpaces } from "../css/values/ColorSpaces.js";
import type { ColorValue, CssValue } from "../css/values/CssValue.js";
import { RemoteResource } from "../net/RemoteResource.js";
import { IccTransform } from "./IccTransform.js";

export interface ColorProfile {
    name: string;
    data: Uint8Array;
    space: string;
    channels: number;
    intent: string;
    components?: ReadonlyArray<string>;
}

const HEADER_LENGTH: number = 128;
const SIGNATURE: string = "acsp";
const DEVICE_CLASSES: ReadonlySet<string> = new Set<string>(["scnr", "mntr", "prtr", "spac"]);
const CHANNEL_COUNTS: ReadonlyMap<string, number> = new Map<string, number>([
    ["XYZ ", 3], ["Lab ", 3], ["Luv ", 3], ["YCbr", 3], ["Yxy ", 3], ["RGB ", 3], ["GRAY", 1], ["HSV ", 3], ["HLS ", 3], ["CMYK", 4], ["CMY ", 3],
    ["2CLR", 2], ["3CLR", 3], ["4CLR", 4], ["5CLR", 5], ["6CLR", 6], ["7CLR", 7], ["8CLR", 8], ["9CLR", 9], ["ACLR", 10], ["BCLR", 11],
    ["CCLR", 12], ["DCLR", 13], ["ECLR", 14], ["FCLR", 15]
]);
const DEFAULT_INTENT: string = "relative-colorimetric";
const NAMED_INKS: string = "CLR";

export class ColorProfiles implements ProfileColors {

    static readonly DEVICE_CMYK: string = "device-cmyk";

    readonly diagnostics: Array<string> = [];
    private readonly profiles: Map<string, ColorProfile> = new Map<string, ColorProfile>();
    private readonly transforms: Map<string, IccTransform | null> = new Map<string, IccTransform | null>();
    private readonly spaces: ColorSpaces = new ColorSpaces();
    private readonly remote: RemoteResource = new RemoteResource();

    constructor(rules: ReadonlyArray<DescriptorRule>) {
        // CSS Color 5 §5.3: "If multiple @color-profile rules are defined with the same name, the last one in document order
        // wins, and all preceding ones are ignored."
        const last: Map<string, DescriptorRule> = new Map<string, DescriptorRule>();
        for (const rule of rules) {
            last.set(rule.name.startsWith("--") ? rule.name : ColorProfiles.DEVICE_CMYK, rule);
        }
        for (const [name, rule] of last) {
            const profile: ColorProfile | undefined = this.load(name, rule);
            if (profile !== undefined) {
                this.profiles.set(name, profile);
            }
        }
    }

    static namesInks(space: string): boolean {
        // ICC.1:2022 §7.2.6: the xCLR spaces, whose channels §10.5 names; an ICCBased space has nowhere to keep the names.
        return space.endsWith(NAMED_INKS);
    }

    profile(name: string): ColorProfile | undefined {
        return this.profiles.get(name);
    }

    channels(name: string): number | undefined {
        return this.profiles.get(name)?.channels;
    }

    components(name: string): ReadonlyArray<string> | undefined {
        return this.profiles.get(name)?.components;
    }

    colorants(name: string): ReadonlyArray<string> {
        // ICC.1:2022 §10.5 names the colorant of each channel, then the components descriptor does. ISO 32000-2 §8.6.6.5: the
        // names are all different, and All and None mean something else; a name no device has goes to the alternate space.
        const count: number = this.channels(name) ?? 0;
        const usable: (names?: ReadonlyArray<string>) => boolean = (names?: ReadonlyArray<string>): boolean => names !== undefined && names.length === count
            && new Set<string>(names).size === count && !names.some((ink: string) => ink.length === 0 || ink === "All" || ink === "None");
        const table: ReadonlyArray<string> | undefined = this.transform(name)?.colorants();
        if (usable(table)) {
            return table as ReadonlyArray<string>;
        }
        const components: ReadonlyArray<string> | undefined = this.components(name);
        return usable(components) ? components as ReadonlyArray<string> : Array.from({ length: count }, (value: unknown, index: number) => "Channel" + (index + 1));
    }

    grid(name: string): ReadonlyArray<number> | undefined {
        return this.transform(name)?.grid();
    }

    toColor(name: string, components: ReadonlyArray<number>, alpha: number | null): ColorValue | undefined {
        // ICC.1:2022 §6.3: the PCS is CIEXYZ or CIELAB relative to D50, which the xyz-d50 and lab spaces of CSS Color 4 are.
        const transform: IccTransform | undefined = this.transform(name);
        const values: Array<number> | undefined = transform?.toConnection(components);
        if (transform === undefined || values === undefined) {
            return undefined;
        }
        const color: ColorValue = { kind: "color", space: transform.connection, components: [values[0], values[1], values[2]], alpha, legacy: false };
        const scale: [number, number, number] | undefined = this.absoluteScale(name, transform);
        if (scale === undefined) {
            return color;
        }
        // ICC.1:2022 §6.3.2.2, equations 4 to 6: ICC-absolute values are the media-relative ones by the media white point
        // over the PCS white point.
        const relative: ColorValue = this.spaces.convert(color, "xyz-d50");
        return { kind: "color", space: "xyz-d50", components: [0, 1, 2].map((index: number) => (relative.components[index] ?? 0) * scale[index]) as [number, number, number], alpha, legacy: false };
    }

    fromColor(name: string, color: ColorValue): Array<number> | undefined {
        const transform: IccTransform | undefined = this.transform(name);
        if (transform === undefined) {
            return undefined;
        }
        const scale: [number, number, number] | undefined = this.absoluteScale(name, transform);
        let source: ColorValue = color;
        if (scale !== undefined) {
            const absolute: ColorValue = this.spaces.convert(color, "xyz-d50");
            source = { kind: "color", space: "xyz-d50", components: [0, 1, 2].map((index: number) => (absolute.components[index] ?? 0) / scale[index]) as [number, number, number], alpha: color.alpha, legacy: false };
        }
        const connection: ColorValue = this.spaces.convert(source, transform.connection);
        return transform.fromConnection(connection.components.map((component: number | null) => component ?? 0));
    }

    private transform(name: string): IccTransform | undefined {
        const profile: ColorProfile | undefined = this.profiles.get(name);
        if (profile === undefined) {
            return undefined;
        }
        let transform: IccTransform | null | undefined = this.transforms.get(name);
        if (transform === undefined) {
            try {
                transform = new IccTransform(profile.data, profile.intent);
            } catch {
                transform = null;
                this.diagnostics.push("The tag table of color profile " + name + " cannot be read, so its colors cannot be converted");
            }
            this.transforms.set(name, transform);
        }
        return transform ?? undefined;
    }

    private absoluteScale(name: string, transform: IccTransform): [number, number, number] | undefined {
        const white: [number, number, number] | undefined = this.profiles.get(name)?.intent === "absolute-colorimetric" ? transform.mediaWhite() : undefined;
        const illuminant: [number, number, number] = transform.illuminant();
        return white === undefined || illuminant.includes(0) || white.includes(0) ? undefined : [white[0] / illuminant[0], white[1] / illuminant[1], white[2] / illuminant[2]];
    }

    private load(name: string, rule: DescriptorRule): ColorProfile | undefined {
        const source: CssValue | undefined = this.valueOf(rule.descriptors["src"]);
        if (source === undefined || source.kind !== "url") {
            this.diagnostics.push("The color profile " + name + " has no src descriptor, so the colors that use it are not valid");
            return undefined;
        }
        const data: Uint8Array | undefined = this.bytes(source.href);
        if (data === undefined) {
            this.diagnostics.push("The color profile " + name + " cannot be read from " + source.href + this.remote.failure(source.href) + ", so the colors that use it are not valid");
            return undefined;
        }
        // ICC.1:2022 §7.2: a 128-byte header with the profile size at byte 0, the class at 12, the color space of the data
        // at 16 and the signature 'acsp' at 36. CSS Color 5 §5.3 takes Input, Display, Output and ColorSpace profiles.
        const size: number = data.length < HEADER_LENGTH ? 0 : new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0);
        const space: string = this.signature(data, 16);
        const channels: number | undefined = CHANNEL_COUNTS.get(space);
        if (size < HEADER_LENGTH || size > data.length || this.signature(data, 36) !== SIGNATURE || !DEVICE_CLASSES.has(this.signature(data, 12)) || channels === undefined) {
            this.diagnostics.push("The file " + source.href + " is not an ICC profile that color profile " + name + " can use, so the colors that use it are not valid");
            return undefined;
        }
        if (ColorProfiles.namesInks(space) && !this.tabulated(data.subarray(0, size), channels)) {
            // ICC.1:2022 §8.5.2: an Output profile has AToB0, without which there is no color to give for these channels.
            this.diagnostics.push("The color profile " + name + " has " + channels + " channels and no table that converts them, so the colors that use it are not valid");
            return undefined;
        }
        if (name === ColorProfiles.DEVICE_CMYK && space !== "CMYK") {
            // CSS Color 5 §6: the profile for device-cmyk() must be "a valid CMYK ICC profile".
            this.diagnostics.push("The color profile for device-cmyk in " + source.href + " is not a CMYK profile, so it is not used");
            return undefined;
        }
        const intent: CssValue | undefined = this.valueOf(rule.descriptors["rendering-intent"]);
        const profile: ColorProfile = {
            name, data: data.subarray(0, size), space, channels, intent: intent !== undefined && intent.kind === "ident" ? intent.lower : DEFAULT_INTENT
        };
        const components: Array<string> | undefined = this.componentNames(this.valueOf(rule.descriptors["components"]));
        if (components !== undefined) {
            profile.components = components;
        }
        return profile;
    }

    private tabulated(data: Uint8Array, channels: number): boolean {
        try {
            const transform: IccTransform = new IccTransform(data, DEFAULT_INTENT);
            const grid: ReadonlyArray<number> | undefined = transform.grid();
            return grid !== undefined && grid.length === channels && grid.every((points: number) => points > 1) && transform.toConnection(new Array<number>(channels).fill(0)) !== undefined;
        } catch {
            return false;
        }
    }

    private componentNames(value?: CssValue): Array<string> | undefined {
        // CSS Color 5 §5.3: "If a component is an ASCII case-insensitive match for none, the descriptor is invalid".
        if (value === undefined) {
            return undefined;
        }
        const names: Array<string> = [];
        for (const item of value.kind === "list" ? value.items : [value]) {
            if (item.kind !== "ident" || item.lower === "none") {
                return undefined;
            }
            names.push(item.name);
        }
        return names;
    }

    private valueOf(declared?: DeclaredValue): CssValue | undefined {
        return declared !== undefined && declared.kind === "value" ? declared.value : undefined;
    }

    private signature(data: Uint8Array, offset: number): string {
        return data.length < offset + 4 ? "" : String.fromCharCode(data[offset], data[offset + 1], data[offset + 2], data[offset + 3]);
    }

    private bytes(location: string): Uint8Array | undefined {
        if (location.startsWith("file:")) {
            const path: string = fileURLToPath(location);
            return existsSync(path) ? readFileSync(path) : undefined;
        }
        return this.remote.retrieveBytes(location);
    }
}
