// frontend-app — branch: main
const App = () => <div>Hello from {process.env.BRANCH || 'main'}</div>;
export default App;