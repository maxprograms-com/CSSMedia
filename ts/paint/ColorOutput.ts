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

import { ColorParser } from "../css/values/ColorParser.js";
import { ColorSpaces } from "../css/values/ColorSpaces.js";
import type { ColorSpace, ColorValue, CssValue, DeviceCmykValue, ProfileColorValue } from "../css/values/CssValue.js";
import type { ColorProfile } from "../pdf/ColorProfiles.js";
import { ColorProfiles } from "../pdf/ColorProfiles.js";
import type { ComputedStyle } from "../pdf/ComputedStyle.js";
import type { ColorSpaceResource } from "../writer/PdfColorSpaces.js";
import { PdfColorSpaces } from "../writer/PdfColorSpaces.js";
import type { PdfDocument } from "../writer/PdfDocument.js";
import type { PdfPage } from "../writer/PdfPage.js";

export type PdfColor = readonly [ColorSpaceResource, ReadonlyArray<number>, number];

const BLACK: ColorValue = { kind: "color", space: "srgb", components: [0, 0, 0], alpha: 1, legacy: false };
const LAB_SPACES: ReadonlySet<string> = new Set<string>(["lab", "lch"]);
const LAB_RANGE: number = 128;
const LAB_OUTPUTS: number = 3;
const SHADE: number = 0.5;

export class ColorOutput {

    private readonly document: PdfDocument;
    private readonly profiles: ColorProfiles;
    private readonly parser: ColorParser;
    private readonly spaces: ColorSpaces = new ColorSpaces();
    private readonly profileSpaces: Map<string, ColorSpaceResource> = new Map<string, ColorSpaceResource>();
    private lab?: ColorSpaceResource;

    constructor(document: PdfDocument, profiles: ColorProfiles) {
        this.document = document;
        this.profiles = profiles;
        this.parser = new ColorParser(profiles);
    }

    restart(): void {
        this.profileSpaces.clear();
        delete this.lab;
    }

    fill(value: CssValue | undefined, style: ComputedStyle, pdf: PdfPage, opacity: number = 1): boolean {
        return this.apply(value, style, pdf, false, opacity);
    }

    stroke(value: CssValue | undefined, style: ComputedStyle, pdf: PdfPage, opacity: number = 1): boolean {
        return this.apply(value, style, pdf, true, opacity);
    }

    solid(value: CssValue | undefined, style: ComputedStyle, pdf: PdfPage, stroking: boolean): boolean {
        // The color without its alpha, for a transparency group that is painted with that alpha as a whole.
        return this.apply(value, style, pdf, stroking, 1, false);
    }

    colorValue(value: CssValue | undefined, style: ComputedStyle): ColorValue | undefined {
        const resolved: ColorValue | DeviceCmykValue | ProfileColorValue | undefined = this.resolve(value, style);
        return resolved === undefined ? undefined : (resolved.kind === "color" ? resolved : this.currentColor(resolved));
    }

    interpolation(method: CssValue): readonly [ColorSpace, string] | undefined {
        return this.parser.interpolationMethod(method);
    }

    labSpace(): ColorSpaceResource {
        this.lab = this.lab ?? this.document.colors.labSpace();
        return this.lab;
    }

    profileOutput(name: string, color: ColorValue): readonly [ColorSpaceResource, ReadonlyArray<number>] | undefined {
        // CSS Color 5 §9.1: a custom color space is that of its profile, whose components are interpolated as they are.
        const profile: ColorProfile | undefined = this.profiles.profile(name);
        const components: Array<number> | undefined = profile === undefined ? undefined : this.profiles.fromColor(name, color);
        return profile === undefined || components === undefined ? undefined : [this.profileSpace(profile), components];
    }

    color(value: CssValue | undefined, style: ComputedStyle): PdfColor | undefined {
        return this.pdfColor(this.resolve(value, style));
    }

    rgba(value: CssValue | undefined, style: ComputedStyle): readonly [number, number, number, number] | undefined {
        const resolved: ColorValue | DeviceCmykValue | ProfileColorValue | undefined = this.resolve(value, style);
        if (resolved === undefined) {
            return undefined;
        }
        const color: ColorValue = resolved.kind === "color" ? resolved : this.currentColor(resolved);
        const srgb: ColorValue = this.spaces.isInGamut(color, "srgb") ? this.spaces.convert(color, "srgb") : this.spaces.gamutMap(color, "srgb");
        const channels: Array<number> = srgb.components.map((channel: number | null) => Math.min(1, Math.max(0, channel ?? 0)));
        return [channels[0], channels[1], channels[2], Math.min(1, Math.max(0, color.alpha ?? 0))];
    }

    linearized(channels: readonly [number, number, number]): readonly [number, number, number] {
        const linear: ColorValue = this.spaces.convert({ kind: "color", space: "srgb", components: channels, alpha: 1, legacy: false }, "srgb-linear");
        return [linear.components[0] ?? 0, linear.components[1] ?? 0, linear.components[2] ?? 0];
    }

    shaded(value: CssValue | undefined, style: ComputedStyle, lighter: boolean): CssValue | undefined {
        // CSS Backgrounds 3 §3.2 leaves to the user agent how much lighter and darker the colors of the 3D styles are.
        const resolved: ColorValue | DeviceCmykValue | ProfileColorValue | undefined = this.resolve(value, style);
        if (resolved === undefined) {
            return undefined;
        }
        const color: ColorValue = resolved.kind === "color" ? resolved : this.currentColor(resolved);
        const srgb: ColorValue = this.spaces.gamutMap(color, "srgb");
        const channels: Array<number> = srgb.components.map((channel: number | null) => {
            const base: number = Math.min(1, Math.max(0, channel ?? 0));
            return lighter ? base + (1 - base) * SHADE : base * (1 - SHADE);
        });
        return { kind: "color", space: "srgb", components: [channels[0], channels[1], channels[2]], alpha: color.alpha, legacy: false };
    }

    private apply(value: CssValue | undefined, style: ComputedStyle, pdf: PdfPage, stroking: boolean, opacity: number, translucent: boolean = true): boolean {
        // A color with an alpha below one is painted with the constant alpha of the graphics state, which stays set until
        // the caller restores the state it saved before painting.
        const color: PdfColor | undefined = this.pdfColor(this.resolve(value, style));
        const alpha: number = color === undefined ? 0 : color[2] * opacity;
        if (color === undefined || alpha <= 0) {
            return false;
        }
        const name: string = pdf.useColorSpace(color[0]);
        if (stroking) {
            pdf.content.strokeSpace(name);
            pdf.content.strokeColor(color[1]);
        } else {
            pdf.content.fillSpace(name);
            pdf.content.fillColor(color[1]);
        }
        if (alpha < 1 && translucent) {
            pdf.content.graphicsState(pdf.useState(stroking ? 1 : alpha, stroking ? alpha : 1, "Normal"));
        }
        return true;
    }

    private resolve(value: CssValue | undefined, style: ComputedStyle): ColorValue | DeviceCmykValue | ProfileColorValue | undefined {
        if (value === undefined) {
            return undefined;
        }
        const own: CssValue | undefined = style.values["color"];
        const target: CssValue = value.kind === "ident" && value.lower === "currentcolor" ? own ?? BLACK : value;
        if (target.kind === "device-cmyk" || target.kind === "profile-color") {
            return target;
        }
        return this.parser.used(target, this.currentColor(own));
    }

    private currentColor(own?: CssValue): ColorValue {
        // CSS Color 5 §6 and §5.3: a device-cmyk() color mixes as the color of its profile, or of the naive conversion, and a
        // profile color as the color of its profile.
        if (own === undefined) {
            return BLACK;
        }
        if (own.kind === "device-cmyk") {
            return this.profiles.toColor(ColorProfiles.DEVICE_CMYK, own.components.map((ink: number | null) => ink ?? 0), own.alpha) ?? this.spaces.cmykToSrgb(own);
        }
        if (own.kind === "profile-color") {
            return this.profiles.toColor(own.profile, own.components.map((component: number | null) => component ?? 0), own.alpha) ?? BLACK;
        }
        const used: ColorValue | DeviceCmykValue | ProfileColorValue | undefined = this.parser.used(own, BLACK);
        return used !== undefined && used.kind === "color" ? used : BLACK;
    }

    private pdfColor(color: ColorValue | DeviceCmykValue | ProfileColorValue | undefined): PdfColor | undefined {
        // CSS Color 4 §4.4: a missing component, alpha included, is zero where the color is used.
        if (color === undefined) {
            return undefined;
        }
        const alpha: number = Math.min(1, Math.max(0, color.alpha ?? 0));
        if (color.kind === "device-cmyk") {
            // CSS Color 5 §6: device-cmyk() is the color of the device, or of the profile that @color-profile gives it.
            const inks: Array<number> = color.components.map((ink: number | null) => Math.min(1, Math.max(0, ink ?? 0)));
            const profile: ColorProfile | undefined = this.profiles.profile(ColorProfiles.DEVICE_CMYK);
            return [profile === undefined ? PdfColorSpaces.CMYK : this.profileSpace(profile), inks, alpha];
        }
        if (color.kind === "profile-color") {
            const profile: ColorProfile | undefined = this.profiles.profile(color.profile);
            return profile === undefined ? undefined : [this.profileSpace(profile), color.components.map((component: number | null) => component ?? 0), alpha];
        }
        if (LAB_SPACES.has(color.space)) {
            // CSS Color 4 §9: lab() and lch() are CIE Lab with the D50 white, the Lab space of ISO 32000-2 §8.6.5.4.
            const lab: ColorValue = this.spaces.convert(color, "lab");
            const lightness: number = Math.min(100, Math.max(0, lab.components[0] ?? 0));
            const a: number = Math.min(LAB_RANGE - 1, Math.max(-LAB_RANGE, lab.components[1] ?? 0));
            const b: number = Math.min(LAB_RANGE - 1, Math.max(-LAB_RANGE, lab.components[2] ?? 0));
            return [this.labSpace(), [lightness, a, b], alpha];
        }
        // CSS Color 4 §14: a color outside the sRGB gamut is mapped into it with the gamut mapping algorithm.
        const srgb: ColorValue = this.spaces.isInGamut(color, "srgb") ? this.spaces.convert(color, "srgb") : this.spaces.gamutMap(color, "srgb");
        const channels: Array<number> = srgb.components.map((channel: number | null) => Math.min(1, Math.max(0, channel ?? 0)));
        return [PdfColorSpaces.RGB, channels, alpha];
    }

    private profileSpace(profile: ColorProfile): ColorSpaceResource {
        let space: ColorSpaceResource | undefined = this.profileSpaces.get(profile.name);
        if (space === undefined) {
            space = ColorProfiles.namesInks(profile.space) ? this.deviceN(profile) : this.document.colors.icc(profile.data, profile.channels);
            this.profileSpaces.set(profile.name, space);
        }
        return space;
    }

    private deviceN(profile: ColorProfile): ColorSpaceResource {
        // The tint transform at the grid points of the profile's own table, so it holds what the profile knows and no more;
        // ISO 32000-2 §7.10.2: the first input varies fastest, and each output takes two bytes here.
        const sizes: ReadonlyArray<number> = this.profiles.grid(profile.name) as ReadonlyArray<number>;
        const total: number = sizes.reduce((product: number, size: number) => product * size, 1);
        const samples: Buffer = this.labSamples(profile.name, total, (index: number): Array<number> => {
            let rest: number = index;
            return sizes.map((size: number) => {
                const tint: number = rest % size / (size - 1);
                rest = Math.floor(rest / size);
                return tint;
            });
        });
        const alone: Array<Buffer> = sizes.map((size: number, channel: number) => this.labSamples(profile.name, size, (index: number): Array<number> =>
            Array.from(sizes.keys(), (position: number) => position === channel ? index / (size - 1) : 0)));
        return this.document.colors.deviceN(this.profiles.colorants(profile.name), sizes, samples, alone);
    }

    private labSamples(name: string, total: number, tintsAt: (index: number) => ReadonlyArray<number>): Buffer {
        const samples: Buffer = Buffer.alloc(total * LAB_OUTPUTS * 2);
        for (let index: number = 0; index < total; index++) {
            const color: ColorValue | undefined = this.profiles.toColor(name, tintsAt(index), 1);
            const lab: ColorValue = this.spaces.convert(color ?? BLACK, "lab");
            const at: number = index * LAB_OUTPUTS * 2;
            samples.writeUInt16BE(this.sample((lab.components[0] ?? 0) / 100), at);
            samples.writeUInt16BE(this.sample(((lab.components[1] ?? 0) + LAB_RANGE) / (2 * LAB_RANGE - 1)), at + 2);
            samples.writeUInt16BE(this.sample(((lab.components[2] ?? 0) + LAB_RANGE) / (2 * LAB_RANGE - 1)), at + 4);
        }
        return samples;
    }

    private sample(fraction: number): number {
        return Math.round(Math.min(1, Math.max(0, fraction)) * 0xFFFF);
    }
}
