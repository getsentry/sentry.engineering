import * as React from "react"
import { Link } from "gatsby"

const Layout = ({ location, title, children }) => {
  const rootPath = `${__PATH_PREFIX__}/`
  const isRootPath = location.pathname === rootPath
  let header

  if (isRootPath) {
    header = (
      <Link className="no-link" to="/">
        <div class="global-logo" aria-label="Sentry Engineering">
          <div class="global-flag">
            <svg
              class="global-sentry-logo"
              width="32"
              height="32"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M17.48 1.996c.45.26.823.633 1.082 1.083l13.043 22.622a2.962 2.962 0 0 1-2.562 4.44h-3.062c.043-.823.039-1.647 0-2.472h3.052a.488.488 0 0 0 .43-.734L16.418 4.315a.489.489 0 0 0-.845 0L12.582 9.51a23.16 23.16 0 0 1 7.703 8.362 23.19 23.19 0 0 1 2.8 11.024v1.234h-7.882v-1.236a15.284 15.284 0 0 0-6.571-12.543l-1.48 2.567a12.301 12.301 0 0 1 5.105 9.987v1.233h-9.3a2.954 2.954 0 0 1-2.56-1.48A2.963 2.963 0 0 1 .395 25.7l1.864-3.26a6.854 6.854 0 0 1 2.15 1.23l-1.883 3.266a.49.49 0 0 0 .43.734h6.758a9.985 9.985 0 0 0-4.83-7.272l-1.075-.618 3.927-6.835 1.075.615a17.728 17.728 0 0 1 6.164 5.956 17.752 17.752 0 0 1 2.653 8.154h2.959a20.714 20.714 0 0 0-3.05-9.627 20.686 20.686 0 0 0-7.236-7.036l-1.075-.618 4.215-7.309a2.958 2.958 0 0 1 4.038-1.083Z"
                fill="currentColor"
              />
            </svg>
          </div>
          <h1 aria-hidden="true">Engineering</h1>
        </div>
      </Link>
    )
  } else {
    header = (
      <Link className="header-link-home" to="/">
        {title}
      </Link>
    )
  }

  return (
    <div>
      <header className="global-header">
        {header}
        <nav className="global-nav">
          <a href="/">blog</a>
          <a href="/">about</a>
          <a href="/">openings</a>
        </nav>
      </header>

      <div className="global-wrapper" data-is-root-path={isRootPath}>
        <main>{children}</main>
      </div>
    </div>
  )
}

export default Layout
