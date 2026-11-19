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

import type { ElementBox } from "../pdf/BoxTree.js";

export class PageFloatPlan {

    private pages: number = 0;
    private previous: Map<ElementBox, number> = new Map<ElementBox, number>();
    private current: Map<ElementBox, number> = new Map<ElementBox, number>();
    private readonly seen: Set<string> = new Set<string>();
    private readonly ids: WeakMap<ElementBox, number> = new WeakMap<ElementBox, number>();
    private count: number = 0;

    start(): void {
        this.current = new Map<ElementBox, number>();
    }

    last(): number {
        return this.pages;
    }

    planned(page: number): Array<ElementBox> {
        const boxes: Array<ElementBox> = [];
        for (const [box, target] of this.previous) {
            if (target === page) {
                boxes.push(box);
            }
        }
        return boxes;
    }

    record(box: ElementBox, page: number): void {
        this.current.set(box, page);
    }

    key(): string {
        return this.pages + ":" + [...this.previous].map((entry: readonly [ElementBox, number]) => this.id(entry[0]) + "@" + entry[1]).join(",");
    }

    settle(pages: number): boolean {
        // CSS Page Floats 3 §5.1: float-defer counts from the last page, which only a whole layout gives, so the floats it moves are
        // laid out again with the pages of the layout before, until the pages and the targets stay; a layout seen before ends it.
        const moved: boolean = (this.current.size > 0 && pages !== this.pages) || this.current.size !== this.previous.size
            || [...this.current].some((entry: readonly [ElementBox, number]) => this.previous.get(entry[0]) !== entry[1]);
        this.previous = this.current;
        this.pages = pages;
        const key: string = this.key();
        if (!moved || this.seen.has(key)) {
            return true;
        }
        this.seen.add(key);
        return false;
    }

    private id(box: ElementBox): number {
        let id: number | undefined = this.ids.get(box);
        if (id === undefined) {
            id = this.count++;
            this.ids.set(box, id);
        }
        return id;
    }
}
