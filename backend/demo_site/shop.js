// Shared header + cart for the demo shop. Cart lives in localStorage.
const PRODUCTS = [
  { id: 1, name: 'Canvas sneakers', price: 49 },
  { id: 2, name: 'Denim jacket', price: 79 },
  { id: 3, name: 'Leather wallet', price: 25 },
]

const cart = {
  get: () => JSON.parse(localStorage.getItem('cart') || '[]'),
  set: items => localStorage.setItem('cart', JSON.stringify(items)),
  add(id) {
    const items = cart.get()
    const found = items.find(i => i.id === id)
    if (found) found.qty += 1
    else items.push({ id, qty: 1 })
    cart.set(items)
  },
  count: () => cart.get().reduce((n, i) => n + i.qty, 0),
}

function renderHeader() {
  document.querySelector('header').innerHTML = `
    <a class="brand" href="/demo/">AcmeCart</a>
    <button id="menu-toggle" aria-label="Menu">☰ Menu</button>
    <nav id="main-nav">
      <a href="/demo/">Shop</a>
      <a href="/demo/checkout.html">Cart (<span id="cart-count">${cart.count()}</span>)</a>
      <a href="/demo/login.html">Sign in</a>
    </nav>`
  // PLANTED BUG 2: the mobile menu button toggles the wrong element, so the menu never opens.
  document.getElementById('menu-toggle').onclick = () => document.getElementById('main-menu')?.classList.toggle('open')
}

renderHeader()
