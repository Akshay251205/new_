// Arrays:Collections of similar datatype items in contegious manner(linear).
// elements are accessed by indices.
let arr=[1,2,3,4,5];
console.log(arr); 
// property of array:
//1.arr_name.length;
//2.typeof arr_name;->arr in js is an object.
//3.to fetch each element we use ->arr_name[index];
// ->>>> Looping over an array:
// for(let i=0;i<arr.length;i++){
//     console.log(arr[i]);
// }
// let i=0;
// while(i<arr.length){
//     console.log(arr[i]);
//     i++;
// }
// for_of loop.
// for(let el of arr){
//     console.log(el);
// }
// for in loop.
// for(let el in arr){
//     console.log(el);
// }
//Array methods:
//1.push()->add one or many items to an end in original array.
//2.pop()->delete from end into original array.
//3.toString()->to convert an array to string
//4.concat()->join multiple arrays and put it into new array.
//5.unshift()->add to start.
//6.shift()->delete from starting.
//7.slice(startidx,endidx(non-inclusive))->give portion of arr which I want.
//8.splice(startidx,delcount,newel...)->change in original array(add,remove,replace))
