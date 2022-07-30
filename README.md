# Rust Problems

A task provider for rust tasks that uses a programatic problem matcher instead of regex to provide additional information.

* Includes quick-fixes for problems even if the fixes might be incorrect
* The probblem view will includes `help` messages as a `HELP` attachment
* The probblem view will includes `note` messages as a `NOTE` attachment
* The probblem view will includes additional spans as a `SPAN` attachement

## Example

Here is an example with an included span and help attachment:

![Example](example.png)
