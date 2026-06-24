import React from 'react';
import './styles.scss';

interface ChatInputProps {
  onChange: (value: string) => void,
  onFocus: () => void,
  onBlur: () => void,
  placeholder: string,
  fontSize: number,
  maxLines: number,
  readOnly?: boolean
}

const ChatInput = React.forwardRef<HTMLSpanElement, ChatInputProps>(
  function ChatInput (props, ref) {
    const handleInput = (event: React.FormEvent<HTMLDivElement>) => {
      const target = event.target as HTMLDivElement;
      // Fix placeholder when new line was used
      if (target.innerHTML === '<br>') {
        target.innerHTML = '';
      }
      props.onChange(target.innerText);
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter') {
        const target = event.target as HTMLDivElement;
        const lines = target.innerHTML.split('<br>').length;
        // Prevent new lines from being created if the number of lines exceeds props.maxLines
        if (lines >= props.maxLines) {
          event.preventDefault();
        }
      }
    };
    return (
    <div className='chat-input--wrapper'>
      <span
        className={`chat-input--text show ${props.readOnly ? 'chat-input--readonly' : ''}`}
        contentEditable={!props.readOnly}
        suppressContentEditableWarning={true}
        // data-* (not `placeholder`, which isn't valid on a <span>) so the CSS below can surface it on the read-only System tab.
        data-placeholder={props.placeholder}
        onInput={handleInput}
        ref={ref}
        id={'chatInput'}
        style={{
          fontSize: props.fontSize
        }}
        onPaste={(event) => {
          // Paste only text
          event.preventDefault();
          document.execCommand(
            'insertText',
            false,
            event.clipboardData.getData('text/plain')
          );
        }}
        onFocus={props.onFocus}
        onBlur={props.onBlur}
        onKeyDown={handleKeyDown}
      />
    </div>
    );
  }
);
export default ChatInput;
