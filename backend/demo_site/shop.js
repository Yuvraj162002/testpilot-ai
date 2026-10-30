// Shared header, footer and cart for the demo shop. Cart lives in localStorage.
const PRODUCTS = [
  { id: 1, name: 'Canvas sneakers', price: 49, cat: 'Shoes', icon: '👟', bg: '#FDE68A,#FCA5A5', rating: 4.6, tag: 'Bestseller' },
  { id: 2, name: 'Denim jacket', price: 79, cat: 'Clothing', icon: '🧥', bg: '#BFDBFE,#A5B4FC', rating: 4.4, tag: 'New' },
  { id: 3, name: 'Leather wallet', price: 25, cat: 'Accessories', icon: '👛', bg: '#FED7AA,#FDBA74', rating: 4.8 },
  { id: 4, name: 'Running shoes', price: 89, cat: 'Shoes', icon: '🥾', bg: '#BBF7D0,#6EE7B7', rating: 4.5, tag: 'New' },
  { id: 5, name: 'Cotton hoodie', price: 59, cat: 'Clothing', icon: '👕', bg: '#E9D5FF,#F0ABFC', rating: 4.3 },
  { id: 6, name: 'Sunglasses', price: 35, cat: 'Accessories', icon: '🕶️', bg: '#CFFAFE,#93C5FD', rating: 4.7, tag: 'Sale' },
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
  setQty(id, qty) {
    cart.set(cart.get().map(i => (i.id === id ? { ...i, qty } : i)).filter(i => i.qty > 0))
  },
  count: () => cart.get().reduce((n, i) => n + i.qty, 0),
}

const product = id => PRODUCTS.find(p => p.id === id)
const stars = r => '★'.repeat(Math.round(r)) + '☆'.repeat(5 - Math.round(r))

function renderHeader() {
  document.querySelector('header').innerHTML = `
    <a class="brand" href="/demo/"><span class="logo">A</span>AcmeCart</a>
    <button id="menu-toggle" aria-label="Menu">☰ Menu</button>
    <nav id="main-nav">
      <a href="/demo/">Shop</a>
      <a href="/demo/checkout.html" class="cart-link">Cart (<span id="cart-count">${cart.count()}</span>)</a>
      <a href="/demo/login.html">Sign in</a>
    </nav>`
  // PLANTED BUG 2: the mobile menu button toggles the wrong element, so the menu never opens.
  document.getElementById('menu-toggle').onclick = () => document.getElementById('main-menu')?.classList.toggle('open')
}

function updateCount() {
  document.getElementById('cart-count').textContent = cart.count()
}

renderHeader()
document.body.insertAdjacentHTML('beforeend', `
  <footer>
    <div><b>AcmeCart</b><p>Demo shop for TestPilot AI. Not a real store.</p></div>
    <div><b>Shop</b><a href="/demo/">New arrivals</a><a href="/demo/checkout.html">Cart</a></div>
    <div><b>Account</b><a href="/demo/login.html">Sign in</a></div>
  </footer>`)
