import getReturnValue from '@libs/getReturnValue';
import mergeRefs from '@libs/mergeRefs';

import CONST from '@src/CONST';

import {cloneElement, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {DeviceEventEmitter} from 'react-native';

import type HoverableProps from './types';

type ActiveHoverableProps = Omit<HoverableProps, 'disabled'>;

type MouseEvents = 'onMouseEnter' | 'onMouseLeave' | 'onMouseMove';

type OnMouseEvents = Record<MouseEvents, (e: React.MouseEvent) => void>;

function ActiveHoverable({onHoverIn, onHoverOut, shouldHandleScroll, isFocused = true, shouldFreezeCapture, shouldUseNativeHoverEvents = false, children, ref}: ActiveHoverableProps) {
    const [isHovered, setIsHovered] = useState(false);
    const elementRef = useRef<HTMLElement | null>(null);
    const isScrollingRef = useRef(false);
    const isHoveredRef = useRef(false);
    const isVisibilityHidden = useRef(false);

    const updateIsHovered = useCallback(
        (hovered: boolean) => {
            if (shouldFreezeCapture) {
                return;
            }

            isHoveredRef.current = hovered;
            isVisibilityHidden.current = false;

            if (shouldHandleScroll && isScrollingRef.current) {
                return;
            }

            setIsHovered(hovered);

            if (hovered) {
                onHoverIn?.();
            } else {
                onHoverOut?.();
            }
        },
        [shouldHandleScroll, shouldFreezeCapture, onHoverIn, onHoverOut],
    );

    useEffect(() => {
        if (!shouldHandleScroll) {
            return;
        }

        const scrollingListener = DeviceEventEmitter.addListener(CONST.EVENTS.SCROLLING, (scrolling: boolean) => {
            isScrollingRef.current = scrolling;
            if (scrolling && isHoveredRef.current) {
                isHoveredRef.current = false;
                setIsHovered(false);
                onHoverOut?.();
            } else if (!scrolling && elementRef.current?.matches(':hover')) {
                isHoveredRef.current = true;
                setIsHovered(true);
                onHoverIn?.();
            }
        });

        return () => scrollingListener.remove();
    }, [shouldHandleScroll, onHoverIn, onHoverOut]);

    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden') {
                isVisibilityHidden.current = true;
                setIsHovered(false);
            } else {
                isVisibilityHidden.current = false;
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, []);

    useEffect(() => {
        if (isFocused) {
            return;
        }
        setIsHovered(false);
    }, [isFocused]);

    const handleMouseEvents = useCallback(
        (type: 'enter' | 'leave') => () => {
            if (shouldFreezeCapture) {
                return;
            }

            const newHoverState = type === 'enter';
            isHoveredRef.current = newHoverState;
            isVisibilityHidden.current = false;

            updateIsHovered(newHoverState);
        },
        [shouldFreezeCapture, updateIsHovered],
    );

    // When opted in, track hover with native DOM listeners on the element rather than React's synthetic events.
    // React delegates synthetic mouse events at the root container, so a portalled popover opening over this
    // element can deliver a synthetic mouseenter (setting a stale hover) or skip the synthetic mouseleave
    // (stranding the hover) — which is what leaves a saved-search row highlighted after its 3-dot popover closes.
    // Native mouseenter/mouseleave fire on the element itself and are immune to that. Web-only; other platforms
    // keep the synthetic path below.
    useEffect(() => {
        const element = elementRef.current;
        if (!shouldUseNativeHoverEvents || !element) {
            return;
        }
        const handleNativeEnter = handleMouseEvents('enter');
        const handleNativeLeave = handleMouseEvents('leave');
        element.addEventListener('mouseenter', handleNativeEnter);
        element.addEventListener('mouseleave', handleNativeLeave);
        return () => {
            element.removeEventListener('mouseenter', handleNativeEnter);
            element.removeEventListener('mouseleave', handleNativeLeave);
        };
    }, [shouldUseNativeHoverEvents, handleMouseEvents]);

    const child = useMemo(() => getReturnValue(children, isHovered), [children, isHovered]);

    const {onMouseEnter, onMouseLeave} = child.props as OnMouseEvents;

    // When using native listeners, don't also attach React's synthetic onMouseEnter/onMouseLeave — the native
    // effect above owns hover tracking. We still forward the child's own handlers so its behavior is unchanged.
    return cloneElement(child, {
        ref: mergeRefs(elementRef, ref, child.props.ref),
        onMouseEnter: (e: React.MouseEvent) => {
            if (!shouldUseNativeHoverEvents) {
                handleMouseEvents('enter')();
            }
            onMouseEnter?.(e);
        },
        onMouseLeave: (e: React.MouseEvent) => {
            if (!shouldUseNativeHoverEvents) {
                handleMouseEvents('leave')();
            }
            onMouseLeave?.(e);
        },
    } as React.HTMLAttributes<HTMLElement>);
}

export default ActiveHoverable;
