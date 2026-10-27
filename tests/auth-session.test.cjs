const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(fs.existsSync('index.html')?'index.html':'source/github-index.html','utf8');
const c=vm.createContext({});
vm.runInContext(html.split('// BEGIN REACH SESSION\n')[1].split('// END REACH SESSION')[0],c);
const storage=()=>{const values=new Map();return{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}};
const user={accessToken:'fictional-test-token',expiresAt:100000,name:'Demo',email:'',picture:null};
test('valid session survives a refresh and sign-out removes it',()=>{
 const s=storage();c.reachWriteSession(s,user);
 assert.equal(c.reachReadSession(s,1000).accessToken,user.accessToken);
 c.reachWriteSession(s,null);assert.equal(c.reachReadSession(s,1000),null);
});
test('expired and nearly expired tokens are discarded',()=>{
 for(const now of [70000,100000,200000]){
  const s=storage();c.reachWriteSession(s,user);
  assert.equal(c.reachReadSession(s,now),null);
  assert.equal(s.getItem('reach_google_session_v1'),null);
 }
});
test('malformed and incompatible stored sessions are discarded',()=>{
 for(const value of ['invalid','null','{}',JSON.stringify({...user,version:2}),JSON.stringify({...user,version:1,expiresAt:'100000'})]){
  const s=storage();s.setItem('reach_google_session_v1',value);
  assert.equal(c.reachReadSession(s,1000),null);
 }
});
test('blocked browser storage does not break sign-in',()=>{
 const s={getItem(){throw Error('blocked')},setItem(){throw Error('blocked')},removeItem(){throw Error('blocked')}};
 assert.equal(c.reachReadSession(s),null);
 assert.doesNotThrow(()=>c.reachWriteSession(s,user));
});
