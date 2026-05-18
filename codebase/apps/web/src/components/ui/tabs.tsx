'use client';

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Tabs as TabsPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

function Tabs({
  className,
  orientation = 'horizontal',
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn('group/tabs flex gap-2 data-[orientation=horizontal]:flex-col', className)}
      {...props}
    />
  );
}

const tabsListVariants = cva(
  'group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-horizontal/tabs:h-8 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none',
  {
    variants: {
      variant: {
        default: 'bg-muted',
        line: 'gap-1 bg-transparent',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function TabsList({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        // Base layout
        'relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-3 py-0.5 text-sm whitespace-nowrap transition-all',
        'group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start',
        // Inactive: muted text, normal weight. Hover lifts to foreground.
        'font-medium text-muted-foreground hover:text-foreground',
        // Focus ring
        'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring',
        // Disabled
        'disabled:pointer-events-none disabled:opacity-50',
        // Icons
        "has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        // ACTIVE STATE — filled primary pill, bold white text, shadow.
        // High-contrast filled pill so the selected tab reads as
        // unambiguously distinct from inactive ones in every theme,
        // not as a subtle background swap that disappears when
        // theme tokens happen to align.
        'data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:font-semibold data-[state=active]:shadow-sm',
        // Line variant overrides: keep transparent bg but still bold +
        // primary-colored text + accent underline.
        'group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent group-data-[variant=line]/tabs-list:data-[state=active]:text-primary group-data-[variant=line]/tabs-list:data-[state=active]:shadow-none',
        // Bottom (or right, for vertical) accent underline — kicks in for
        // both variants so even if the filled pill is somehow obscured,
        // the underline still signals the active tab.
        'after:absolute after:bg-accent after:rounded-full after:opacity-0 after:transition-opacity',
        'group-data-horizontal/tabs:after:inset-x-2 group-data-horizontal/tabs:after:bottom-[-5px] group-data-horizontal/tabs:after:h-[3px]',
        'group-data-vertical/tabs:after:inset-y-2 group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-[3px]',
        'data-[state=active]:after:opacity-100',
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('flex-1 text-sm outline-none', className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants };
