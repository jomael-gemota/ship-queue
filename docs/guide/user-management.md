# User Management

The **User Management** page is for **admins**. It's where you control who can
sign in, who can create labels, and who is an admin.

![The User Management page with user counts and the employees table](/screenshots/user-management.png)

::: info Admins only
If you're not an admin, this page shows a short note: *"User Management is
restricted."* That's expected — contact an admin if you need a change made to
your access.
:::

## What you'll see

At the top, three quick counts:

- **Total users** — everyone with an account.
- **Can create labels** — how many people have label permission.
- **Admins** — how many admins there are.

Below that is the **Employees** table, with one row per person. It shows their
name and email, role, when they joined, their last login, and whether they can
create labels.

Use the **Search by name or email** box to find someone quickly.

## Granting or removing label permission

In the **Create Labels** column, use the toggle to **grant** or **revoke** a
person's ability to create shipping labels.

- A regular user shows **Granted** or **Denied** with a toggle you can flip.
- Admins always show **always on** — admins can create labels by default.

![The Create Labels column with the Granted and Denied toggles highlighted](/screenshots/user-mgmt-create-labels.png)

## Changing someone's role

Each person is either a **User** or an **Admin**. To change a role, use the role
dropdown on their row:

- Choose **Admin** to promote — confirm with **Make Admin**.
- Choose **User** to demote — confirm with **Make User**.

![The Role column with the per-user role dropdowns highlighted](/screenshots/user-mgmt-roles.png)

::: tip A couple of safeguards
- You can't change **your own** role.
- Admins are always trusted to create labels, so there's no separate label
  toggle for them.
:::

## Removing a user

To remove a regular user's access, click the trash icon on their row, then
confirm with **Remove user**. They'll be removed and would need to sign in again
to regain access.

![The Remove user confirmation dialog with Cancel and Remove user buttons](/screenshots/user-mgmt-remove.png)

Admins can't be removed with this button — demote them to **User** first if you
really need to remove them.

## What's next?

- Configure system options in [Settings](/guide/settings).
- See the full access overview in [FAQ & Troubleshooting](/guide/faq).
