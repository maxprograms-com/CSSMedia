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

import type { CssValue } from "../css/values/CssValue.js";
import type { FontMetrics } from "./FontMetrics.js";
import type { RelativeUnits } from "./LengthResolver.js";
import type { Size } from "./PageCanvas.js";

interface UnitSources {
    local: Readonly<Record<string, CssValue>>;
    lineHeight: Readonly<Record<string, CssValue>>;
    root: Readonly<Record<string, CssValue>>;
    rootLineHeight: Readonly<Record<string, CssValue>>;
    viewport: Size;
    horizontal: () => boolean;
    container: (axis: ContainerAxis) => number | null;
    require: (unit: string) => void;
    zoom: (source: ZoomSource) => number;
}

export type ContainerAxis = "width" | "height" | "inline" | "block";

export type ZoomSource = "absolute" | "local" | "line-height" | "root";

const CONTAINER_AXES: ReadonlyMap<string, ReadonlyArray<ContainerAxis>> = new Map<string, ReadonlyArray<ContainerAxis>>([
    ["cqw", ["width"]], ["cqh", ["height"]], ["cqi", ["inline"]], ["cqb", ["block"]], ["cqmin", ["inline", "block"]], ["cqmax", ["inline", "block"]]
]);

export class ElementUnits implements RelativeUnits {

    private readonly metrics: FontMetrics;
    private readonly sources: UnitSources;

    constructor(metrics: FontMetrics, sources: UnitSources) {
        this.metrics = metrics;
        this.sources = sources;
    }

    absolute(): number {
        // CSS Viewport 1 (Editor's Draft) §4: absolute lengths are multiplied by the effective zoom.
        return this.sources.zoom("absolute");
    }

    size(unit: string): number | undefined {
        // CSS Values 4 §6.1: font-relative units from the local or the root font, viewport units from the page area; the
        // properties a unit depends on are computed first.
        const sources: UnitSources = this.sources;
        sources.require(unit);
        switch (unit) {
            case "em":
                return this.metrics.fontSize(sources.local) * sources.zoom("local");
            case "ex":
                return this.metrics.xHeight(sources.local) * sources.zoom("local");
            case "cap":
                return this.metrics.capHeight(sources.local) * sources.zoom("local");
            case "ch":
                return this.metrics.zeroAdvance(sources.local) * sources.zoom("local");
            case "ic":
                return this.metrics.ideographicAdvance(sources.local) * sources.zoom("local");
            case "lh":
                return this.metrics.lineHeight(sources.lineHeight) * sources.zoom("line-height");
            case "rem":
                return this.metrics.fontSize(sources.root) * sources.zoom("root");
            case "rex":
                return this.metrics.xHeight(sources.root) * sources.zoom("root");
            case "rcap":
                return this.metrics.capHeight(sources.root) * sources.zoom("root");
            case "rch":
                return this.metrics.zeroAdvance(sources.root) * sources.zoom("root");
            case "ric":
                return this.metrics.ideographicAdvance(sources.root) * sources.zoom("root");
            case "rlh":
                return this.metrics.lineHeight(sources.rootLineHeight) * sources.zoom("root");
            default:
                return this.viewportUnit(unit);
        }
    }

    private viewportUnit(unit: string): number | undefined {
        // CSS Values 4 §6.1.2: paged media has one viewport size, the page area of the first page; container sizes come
        // with the zoom already applied.
        const zoom: number = this.sources.zoom("absolute");
        const width: number = this.sources.viewport.width / 100 * zoom;
        const height: number = this.sources.viewport.height / 100 * zoom;
        const horizontal: boolean = this.sources.horizontal();
        const inline: number = horizontal ? width : height;
        const block: number = horizontal ? height : width;
        const axes: ReadonlyArray<ContainerAxis> | undefined = CONTAINER_AXES.get(unit);
        if (axes !== undefined) {
            // CSS Conditional 5 §7: each axis takes the nearest container that accepts size queries on it, and "If no eligible
            // query container is available, then use the small viewport size for that axis".
            const fallbacks: Readonly<Record<ContainerAxis, number>> = { width, height, inline, block };
            let result: number = unit === "cqmax" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
            for (const axis of axes) {
                const size: number | null = this.sources.container(axis);
                const length: number = size === null ? fallbacks[axis] : size / 100;
                result = unit === "cqmax" ? Math.max(result, length) : Math.min(result, length);
            }
            return result;
        }
        switch (unit.replace(/^(?:sv|lv|dv)/, "v")) {
            case "vw":
                return width;
            case "vh":
                return height;
            case "vi":
                return inline;
            case "vb":
                return block;
            case "vmin":
                return Math.min(width, height);
            case "vmax":
                return Math.max(width, height);
            default:
                return undefined;
        }
    }
}
