// Loops:loops are used to execute a piece of code again and again.
// 1.for loop:
// for(initialisation,stopping condition,updation){
    // what to do in loop.
// }
// example:
// let i=1
// for(i;i<=5;i++){
//     console.log("Akshay");
// }
// console.log(i)
// infinite loop: never ends.
// 2.while loop:
// while(cond){
//      do some work;
// }
// example:
// let i=5;

// while(i<10){
//     console.log(i);
//     i++;
// }
// 3.do while loop:
// do{
//     // do some work
// }while(condition);
// do while loop atleast work for 1 time.
// example:
// let i=20;
// do{
//     console.log("Apnapan");
//     i++;
// }while(i<=10);
// 4.for-of loop:Used for string and array.
// for(let var of strVar){
    // do some work.
// }
// let str="Akshay";
// for(let i of str){
//     // iterator in character
//     console.log("i=",i);
// }
// 5. for-in loop:used for objects.
// for(let key in objVar){
// work to do.
// }
// let student={
//     name: "Rahul",
//     age: 20,
//     cgpa:9,
//     isPass: true
// }//object
// for(let i in student){
//     console.log(i,student[i]);
// }
// ->>>>>>>>STRINGS:sequence of char used to represent text.
// let str='akshay';
// let str1="akshay kumar jha";
// properties of strings:
// 1.string length:strname.length
// 2.string indices:strname[indexpositions starting form 0. ]
// ->>>>>>>Tamplet literals(``)
// let specialstr=`tamplate literal`;
// console.log(typeof specialstr)
// why template literals:
// we can use template literals to ease the string output(string interpolation).
// example:
// let output=`the cost of ${2} is ${5} rupees.`;
// console.log(output);
// ->>>>escape character:
// \n->next line.
// \t->tab space.
// ->>>>>>String methods and functions:method does not change the original variable as strings are immutable in javascript.
// 1.uppercase->str.toUpperCase();
// 2.lowercase->str.toLowerCase();
// 3.trim->to remove white space from start and end->str.trim();
// 4.slice->return part of the string.->str.slice(start,end(non inclusive));
// 5.concatination->join 2 strings.->str.concat(str1)or str+str1;
// 6.replace->str.replace("searchval","replaceval");
// 6.replace->str.replaceAll("searchval","replaceval");
// 7.charat->str.charAt(index);





