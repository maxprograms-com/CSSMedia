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
import type { SourceElement } from "../parse/SourceElement.js";
import type { Cascade } from "../pdf/Cascade.js";
import type { ComputedStyle } from "../pdf/ComputedStyle.js";
import type { DisplayType } from "../pdf/DisplayTypes.js";
import { DisplayTypes } from "../pdf/DisplayTypes.js";
import { StyleComputer } from "../pdf/StyleComputer.js";

const NO_SIZE: { width: number; height: number } = { width: 0, height: 0 };

export class InFlow {

    private readonly cascade: Cascade;
    private readonly computer: StyleComputer;
    private readonly displays: DisplayTypes = new DisplayTypes();
    private readonly styles: WeakMap<SourceElement, ComputedStyle> = new WeakMap<SourceElement, ComputedStyle>();

    constructor(cascade: Cascade, computer: StyleComputer) {
        this.cascade = cascade;
        this.computer = computer;
    }

    children(element: SourceElement, wanted: (child: SourceElement) => boolean): Array<SourceElement> {
        // MathML Core §3.2.4.1 and §3.4.2.1 read the "in-flow children": a child with display none generates no box, one with
        // display contents gives its own children to its parent, and a positioned or running child leaves the flow (§3.1.2).
        const found: Array<SourceElement> = [];
        for (const child of element.getChildren()) {
            if (!wanted(child)) {
                continue;
            }
            const style: ComputedStyle = this.style(child);
            const display: DisplayType = this.displays.parse(style.values["display"]);
            if (display.box === "none") {
                continue;
            }
            if (display.box === "contents") {
                found.push(...this.children(child, wanted));
            } else if (!this.leaves(style.values["position"])) {
                found.push(child);
            }
        }
        return found;
    }

    private leaves(position?: CssValue): boolean {
        if (position === undefined) {
            return false;
        }
        return (position.kind === "function" && position.name === "running") || (position.kind === "ident" && (position.lower === "absolute" || position.lower === "fixed"));
    }

    private style(element: SourceElement): ComputedStyle {
        let style: ComputedStyle | undefined = this.styles.get(element);
        if (style === undefined) {
            const parent: SourceElement | undefined = element.getParent();
            style = this.computer.compute(StyleComputer.input(this.cascade.flowDeclarations(element), NO_SIZE, StyleComputer.NO_CONTAINERS,
                parent === undefined ? undefined : this.style(parent), undefined, element));
            this.styles.set(element, style);
        }
        return style;
    }
}
