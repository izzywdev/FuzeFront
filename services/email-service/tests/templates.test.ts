import { renderTemplate } from '../src/templates';

describe('renderTemplate', () => {
  it('renders welcome email with firstName', () => {
    const result = renderTemplate('welcome', { firstName: 'Alice', loginUrl: 'https://app.fuzefront.com' });
    expect(result.subject).toContain('Welcome');
    expect(result.html).toContain('Alice');
    expect(result.text).toContain('Alice');
  });

  it('renders org-invite with orgName and inviteUrl', () => {
    const result = renderTemplate('org-invite', {
      orgName: 'Acme Corp',
      inviteUrl: 'https://app.fuzefront.com/accept?token=abc',
      inviterName: 'Bob',
    });
    expect(result.subject).toContain('Acme Corp');
    expect(result.html).toContain('Acme Corp');
    expect(result.html).toContain('Bob');
  });

  it('renders membership-change with action', () => {
    const result = renderTemplate('membership-change', {
      orgName: 'Acme Corp',
      action: 'added',
      role: 'member',
    });
    expect(result.html).toContain('Acme Corp');
    expect(result.html).toContain('added');
  });

  it('renders FuzePicker mention and reply templates with escaped content', () => {
    const mention = renderTemplate('fuzepicker-mention', {
      senderName: '<Ada>',
      message: 'Review <this> component',
      mentionUrl: 'https://app.fuzefront.com/fuzepicker/mentions?invite=token',
    });
    const reply = renderTemplate('fuzepicker-reply', {
      recipientName: '<Grace>',
      message: 'Looks good <script>',
      mentionsUrl: 'https://app.fuzefront.com/fuzepicker/mentions',
    });

    expect(mention.subject).toContain('<Ada>');
    expect(mention.html).toContain('&lt;Ada&gt;');
    expect(mention.html).toContain('&lt;this&gt;');
    expect(reply.html).toContain('&lt;Grace&gt;');
    expect(reply.html).toContain('&lt;script&gt;');
  });

  it('does not allow a FuzePicker display name to inject email headers', () => {
    const result = renderTemplate('fuzepicker-mention', {
      senderName: 'Ada\r\nBcc: attacker@example.com',
      message: 'Please review',
      mentionUrl: 'https://app.fuzefront.com/fuzepicker/mentions',
    });

    expect(result.subject).not.toMatch(/[\r\n]/);
  });

  it('throws on unknown template', () => {
    expect(() => renderTemplate('unknown' as any, {})).toThrow(/Unknown template/);
  });
});
