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

import type { PropertyTable } from "./PropertyTable.js";

const LOGICAL_CORNER: RegExp = /(?:^|-)(start|end)-(start|end)(?:-|$)/;
const PHYSICAL_CORNER: RegExp = /(?:^|-)(top|bottom)-(left|right)(?:-|$)/;
const LOGICAL_SIDE: RegExp = /(?:^|-)(block|inline)-(start|end)(?:-|$)/;
const PHYSICAL_SIDE: RegExp = /(?:^|-)(top|right|bottom|left)(?:-|$)/;
const LOGICAL_AXIS: RegExp = /(?:^|-)(block|inline)(?:-size)?(?:-|$)/;
const PHYSICAL_AXIS: RegExp = /(?:^|-)(width|height|x|y)(?:-|$)/;

export class LogicalProperties {

    private readonly members: Map<string, Map<string, string>> = new Map<string, Map<string, string>>();
    private readonly logical: Map<string, [string, string]> = new Map<string, [string, string]>();
    private readonly grouped: Set<string> = new Set<string>();
    private readonly paired: Map<string, Map<string, ReadonlyArray<readonly [string, string]>>> = new Map<string, Map<string, ReadonlyArray<readonly [string, string]>>>();

    constructor(table: PropertyTable) {
        // CSS Logical 1 §4: the properties of a logical property group set equivalent styles on the sides, corners or
        // dimensions of a box, physical or flow-relative.
        for (const name of table.names()) {
            const group: string | undefined = table.definition(name)?.logicalPropertyGroup;
            const key: [string, boolean] | undefined = group === undefined ? undefined : this.keyOf(name);
            if (group === undefined || key === undefined) {
                continue;
            }
            let keys: Map<string, string> | undefined = this.members.get(group);
            if (keys === undefined) {
                keys = new Map<string, string>();
                this.members.set(group, keys);
            }
            keys.set(key[0], name);
            this.grouped.add(name);
            if (key[1]) {
                this.logical.set(name, [group, key[0]]);
            }
        }
    }

    pairs(writingMode: string, direction: string): ReadonlyArray<readonly [string, string]> {
        // CSS Logical 1 §4: each flow-relative property pairs with the physical one its writing mode maps it to.
        let modes: Map<string, ReadonlyArray<readonly [string, string]>> | undefined = this.paired.get(writingMode);
        if (modes === undefined) {
            modes = new Map<string, ReadonlyArray<readonly [string, string]>>();
            this.paired.set(writingMode, modes);
        }
        let result: ReadonlyArray<readonly [string, string]> | undefined = modes.get(direction);
        if (result === undefined) {
            const pairs: Array<[string, string]> = [];
            for (const [name, [group, key]] of this.logical) {
                const physical: string | undefined = this.members.get(group)?.get(this.physicalKey(key, writingMode, direction));
                if (physical !== undefined) {
                    pairs.push([name, physical]);
                }
            }
            result = pairs;
            modes.set(direction, result);
        }
        return result;
    }

    isGrouped(property: string): boolean {
        return this.grouped.has(property);
    }

    private keyOf(name: string): [string, boolean] | undefined {
        const logicalCorner: RegExpExecArray | null = LOGICAL_CORNER.exec(name);
        if (logicalCorner !== null) {
            return [logicalCorner[1] + "-" + logicalCorner[2], true];
        }
        const physicalCorner: RegExpExecArray | null = PHYSICAL_CORNER.exec(name);
        if (physicalCorner !== null) {
            return [physicalCorner[1] + "-" + physicalCorner[2], false];
        }
        const logicalSide: RegExpExecArray | null = LOGICAL_SIDE.exec(name);
        if (logicalSide !== null) {
            return [logicalSide[1] + "-" + logicalSide[2], true];
        }
        const physicalSide: RegExpExecArray | null = PHYSICAL_SIDE.exec(name);
        if (physicalSide !== null) {
            return [physicalSide[1], false];
        }
        const logicalAxis: RegExpExecArray | null = LOGICAL_AXIS.exec(name);
        if (logicalAxis !== null) {
            return [logicalAxis[1], true];
        }
        const physicalAxis: RegExpExecArray | null = PHYSICAL_AXIS.exec(name);
        if (physicalAxis !== null) {
            return [physicalAxis[1] === "width" || physicalAxis[1] === "x" ? "x" : "y", false];
        }
        return undefined;
    }

    private physicalKey(key: string, writingMode: string, direction: string): string {
        // CSS Writing Modes 4 §6: block-start is the top in horizontal-tb, the right in vertical-rl and sideways-rl, and the
        // left in vertical-lr and sideways-lr; inline-start is the line-left side in ltr and the line-right side in rtl.
        const horizontal: boolean = writingMode === "horizontal-tb";
        const blockStart: string = horizontal ? "top" : (writingMode === "vertical-rl" || writingMode === "sideways-rl" ? "right" : "left");
        const lineLeft: string = horizontal ? "left" : (writingMode === "sideways-lr" ? "bottom" : "top");
        const inlineStart: string = direction === "rtl" ? this.opposite(lineLeft) : lineLeft;
        const side: (logical: string) => string = (logical: string): string => {
            switch (logical) {
                case "block-start":
                    return blockStart;
                case "block-end":
                    return this.opposite(blockStart);
                case "inline-start":
                    return inlineStart;
                default:
                    return this.opposite(inlineStart);
            }
        };
        if (key === "block" || key === "inline") {
            return (key === "inline") === horizontal ? "x" : "y";
        }
        const corner: RegExpExecArray | null = /^(start|end)-(start|end)$/.exec(key);
        if (corner === null) {
            return side(key);
        }
        const sides: Array<string> = [side("block-" + corner[1]), side("inline-" + corner[2])];
        const vertical: string = sides.find((value: string) => value === "top" || value === "bottom") as string;
        const across: string = sides.find((value: string) => value === "left" || value === "right") as string;
        return vertical + "-" + across;
    }

    private opposite(side: string): string {
        switch (side) {
            case "top":
                return "bottom";
            case "bottom":
                return "top";
            case "left":
                return "right";
            default:
                return "left";
        }
    }
}
