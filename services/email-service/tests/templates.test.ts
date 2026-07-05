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

  it('throws on unknown template', () => {
    expect(() => renderTemplate('unknown' as any, {})).toThrow(/Unknown template/);
  });
});
