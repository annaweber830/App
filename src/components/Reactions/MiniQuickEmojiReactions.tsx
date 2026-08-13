import type {Emoji} from '@assets/emojis/types';

import BaseMiniContextMenuItem from '@components/BaseMiniContextMenuItem';
import Icon from '@components/Icon';
import Text from '@components/Text';

import {useMemoizedLazyExpensifyIcons} from '@hooks/useLazyAsset';
import useLocalize from '@hooks/useLocalize';
import useOnyx from '@hooks/useOnyx';
import useStyleUtils from '@hooks/useStyleUtils';
import useThemeStyles from '@hooks/useThemeStyles';

import {getLocalizedEmojiName, getPreferredEmojiCode} from '@libs/EmojiUtils';
import getButtonState from '@libs/getButtonState';
import getHadTabNavigation from '@libs/hadTabNavigation';

import variables from '@styles/variables';

import {emojiPickerRef, showEmojiPicker} from '@userActions/EmojiPickerAction';
import {callFunctionIfActionIsAllowed} from '@userActions/Session';

import CONST from '@src/CONST';
import ONYXKEYS from '@src/ONYXKEYS';
import type {ReportActionReactions} from '@src/types/onyx';
import {getEmptyObject} from '@src/types/utils/EmptyObject';

import React, {useCallback, useRef} from 'react';
import {View} from 'react-native';

import type {BaseQuickEmojiReactionsProps} from './QuickEmojiReactions/types';

type MiniQuickEmojiReactionsProps = BaseQuickEmojiReactionsProps & {
    /**
     * Will be called when the user closed the emoji picker
     * without selecting an emoji.
     */
    onEmojiPickerClosed?: () => void;
};

/**
 * Shows the four common quick reactions and a
 * emoji picker icon button. This is used for the mini
 * context menu which we just show on web, when hovering
 * a message.
 */
function MiniQuickEmojiReactions({reportAction, reportActionID, onEmojiSelected, onPressOpenPicker = () => {}, onEmojiPickerClosed = () => {}}: MiniQuickEmojiReactionsProps) {
    const icons = useMemoizedLazyExpensifyIcons(['AddReaction']);
    const styles = useThemeStyles();
    const StyleUtils = useStyleUtils();
    const firstReactionRef = useRef<View | HTMLDivElement>(null);
    const secondReactionRef = useRef<View | HTMLDivElement>(null);
    const thirdReactionRef = useRef<View | HTMLDivElement>(null);
    const addReactionRef = useRef<View | HTMLDivElement>(null);
    const reactionRefs = [firstReactionRef, secondReactionRef, thirdReactionRef, addReactionRef];
    const {translate, preferredLocale} = useLocalize();
    const [preferredSkinTone = CONST.EMOJI_DEFAULT_SKIN_TONE] = useOnyx(ONYXKEYS.PREFERRED_EMOJI_SKIN_TONE);
    const [emojiReactions = getEmptyObject<ReportActionReactions>()] = useOnyx(`${ONYXKEYS.COLLECTION.REPORT_ACTIONS_REACTIONS}${reportActionID}`);

    const selectEmojiWithReaction = useCallback(
        (emoji: Emoji, skinTone: number) => {
            onEmojiSelected(emoji, emojiReactions, skinTone);
        },
        [onEmojiSelected, emojiReactions],
    );

    const openEmojiPicker = () => {
        onPressOpenPicker();
        showEmojiPicker({
            onModalHide: onEmojiPickerClosed,
            onEmojiSelected: (_emojiCode, emojiObject, skinTone) => {
                selectEmojiWithReaction(emojiObject, skinTone);
            },
            emojiPopoverAnchor: addReactionRef,
            id: reportAction.reportActionID,
        });
    };

    const moveFocusWithArrowKey = (event: React.KeyboardEvent, currentIndex: number) => {
        const isPreviousKey = event.key === CONST.KEYBOARD_SHORTCUTS.ARROW_LEFT.shortcutKey || event.key === CONST.KEYBOARD_SHORTCUTS.ARROW_UP.shortcutKey;
        const isNextKey = event.key === CONST.KEYBOARD_SHORTCUTS.ARROW_RIGHT.shortcutKey || event.key === CONST.KEYBOARD_SHORTCUTS.ARROW_DOWN.shortcutKey;

        if ((!isPreviousKey && !isNextKey) || !getHadTabNavigation()) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const nextIndex = isPreviousKey ? (currentIndex - 1 + reactionRefs.length) % reactionRefs.length : (currentIndex + 1) % reactionRefs.length;
        reactionRefs.at(nextIndex)?.current?.focus();
    };

    return (
        <View style={styles.flexRow}>
            {CONST.QUICK_REACTIONS.slice(0, 3).map((emoji: Emoji, index) => (
                <BaseMiniContextMenuItem
                    key={emoji.name}
                    ref={reactionRefs.at(index)}
                    isDelayButtonStateComplete={false}
                    tooltipText={`:${getLocalizedEmojiName(emoji.name, preferredLocale)}:`}
                    onPress={callFunctionIfActionIsAllowed(() => onEmojiSelected(emoji, emojiReactions, preferredSkinTone))}
                    onKeyDown={(event) => moveFocusWithArrowKey(event, index)}
                    sentryLabel={CONST.SENTRY_LABEL.MINI_CONTEXT_MENU.QUICK_REACTION}
                >
                    <Text
                        style={[styles.miniQuickEmojiReactionText, styles.userSelectNone]}
                        dataSet={{[CONST.SELECTION_SCRAPER_HIDDEN_ELEMENT]: true}}
                    >
                        {getPreferredEmojiCode(emoji, preferredSkinTone)}
                    </Text>
                </BaseMiniContextMenuItem>
            ))}
            <BaseMiniContextMenuItem
                ref={addReactionRef}
                onPress={callFunctionIfActionIsAllowed(() => {
                    if (!emojiPickerRef.current?.isEmojiPickerVisible) {
                        openEmojiPicker();
                    } else {
                        emojiPickerRef.current?.hideEmojiPicker();
                    }
                })}
                onKeyDown={(event) => moveFocusWithArrowKey(event, reactionRefs.length - 1)}
                isDelayButtonStateComplete={false}
                tooltipText={translate('emojiReactions.addReactionTooltip')}
                sentryLabel={CONST.SENTRY_LABEL.MINI_CONTEXT_MENU.EMOJI_PICKER_BUTTON}
            >
                {({hovered, pressed}) => (
                    <Icon
                        width={variables.iconSizeMedium}
                        height={variables.iconSizeMedium}
                        src={icons.AddReaction}
                        fill={StyleUtils.getIconFillColor(getButtonState(hovered, pressed, false))}
                    />
                )}
            </BaseMiniContextMenuItem>
        </View>
    );
}

export default MiniQuickEmojiReactions;
